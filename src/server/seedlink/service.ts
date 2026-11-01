/**
 * SERVICIO CENTRAL SEEDLINK Y ORQUESTADOR SÍSMICO
 * Gestiona el pool multi-servidor SeedLink TCP (25 servidores con timeout 20s),
 * el procesamiento DSP (STA/LTA, aceleración, amplitud, PGA, Mercalli MMI),
 * buffers de oscilograma (Swarm) y difusión en tiempo real vía WebSocket.
 */

import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { SeedLinkMultiPool, PacketEventPayload } from './multi-pool';
import { SeedLinkServerStatus, SEEDLINK_SERVERS } from './server-list';
import { SeismicDspEngine, ProcessedPacketResult, isRaspberryShake, DEFAULT_STA_LTA_CONFIG } from './seismic-dsp';
import { MiniSeedRecord } from './miniseed';
import { SeismicDetectorEngine, generateDisplayId } from './detector';
import { NoiseCalibrator } from './noise-calibrator';
import { StationReceptionQc } from './station-qc';
import { OnsetBuffer } from './pick-refiner';

export interface StationMetadata {
  network: string;
  networkName: string;
  code: string;
  fullCode: string;
  site: string;
  state: string;
  lat: number;
  lon: number;
  alt: number;
  channelCount: number;
  channels: any[];
  primaryChannel: string;
  work: boolean;
}

export interface LiveStationState {
  code: string;
  network: string;
  fullCode: string;
  site: string;
  state: string;
  lat: number;
  lon: number;
  primaryChannel: string;
  acceleration: number;
  accelerationStr: string;
  amp: number;
  ampUnit: string;
  ampStr: string;
  status: 'Recibiendo' | 'En línea' | 'Disparo STA/LTA' | 'Reposo' | 'Sin datos' | 'Recepción degradada' | 'Recuperando traza';
  delay: string;
  delaySec: number;
  pga: number;
  pgaStr: string;
  intensity: number;
  lastPacketTime: string | null;
  lastReceivedWallTime?: number;
  staLtaRatio: number;
  triggered: boolean;
  sampleRate: number;
  packetCount: number;
  serverSource: string;
  noiseClass?: string;
}

export interface WaveformPoint {
  time: string;
  count: number;
  accelGal: number;
}

/**
 * Estaciones expresamente excluidas de conexión y procesamiento sísmico (Isla Socorro y SV.TECD)
 */
export const EXCLUDED_STATIONS = new Set<string>([
  'H06E',
  'TECD',
  'IG.H06E',
  'SV.TECD'
]);

export class SeedLinkService {
  private static instance: SeedLinkService | null = null;
  private pool: SeedLinkMultiPool;
  private dsp: SeismicDspEngine;
  private wss: WebSocketServer | null = null;
  private stationsCatalog: Map<string, StationMetadata> = new Map();
  private liveStates: Map<string, LiveStationState> = new Map();
  private streamLastPacketTime: Map<string, number> = new Map();
  private readonly receptionQc = new StationReceptionQc();
  private readonly onsetBuffers: Map<string, OnsetBuffer> = new Map();

  // Identificador único de inicio de sesión del servidor y fecha de arranque
  public readonly serverBootId: string = `boot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  public readonly serverStartTime: string = new Date().toISOString();

  // Estado activo de Alerta de Tsunami (difundido a todos los monitores)
  private activeTsunamiAlert: any | null = null;

  // Estaciones activas en el visor SWARM
  private activeSwarmStations: Set<string> = new Set();

  // Buffers circulares de ondas para visualizador Swarm (Máximo 1500 puntos por estación)
  private waveformBuffers: Map<string, WaveformPoint[]> = new Map();
  private maxBufferPoints: number = 1500;

  // Motor secuencial de detección, triangulación de epicentro y magnitud
  private detector: SeismicDetectorEngine;

  // Intervalo de latencia y fondo
  private backgroundInterval: NodeJS.Timeout | null = null;

  // Programador automático del 2° Simulacro Nacional del 19 de Septiembre (12:00 PM CDMX)
  private nationalDrillInterval: NodeJS.Timeout | null = null;
  private hasTriggeredNationalDrill: boolean = false;

  private constructor() {
    this.dsp = new SeismicDspEngine({
      staSec: DEFAULT_STA_LTA_CONFIG.staSec,
      ltaSec: DEFAULT_STA_LTA_CONFIG.ltaSec,
      threshold: DEFAULT_STA_LTA_CONFIG.thresholdStandard,
    });

    this.detector = SeismicDetectorEngine.getInstance();
    this.detector.setOnEventDetected((event) => {
      console.log(`[SeedLinkService] Difundiendo evento sísmico detectado vía WebSocket: ${event.id} (${event.location})`);
      this.broadcastWebSocket({
        type: 'earthquake_detected',
        event,
      });
    });
    // Un preliminar que no logra evidencia suficiente se retira con el mismo mensaje que la cancelación manual
    this.detector.setOnEventCancelled((event, reason) => {
      console.log(`[SeedLinkService] Retirando evento preliminar sin evidencia: ${event.id} (${reason})`);
      this.broadcastWebSocket({
        type: 'earthquake_cancelled',
        eventId: event.id,
        displayId: event.displayId || generateDisplayId(event.id),
        audio: 'desconfirmacion.mp3',
        message: 'Sismo preliminar descartado: no fue corroborado por la red.',
        reason,
        cancelledAt: new Date().toISOString(),
      });
    });

    this.loadStationsCatalog();

    // Inicializar Pool de 25 Servidores SeedLink con Timeout de 20s
    this.pool = new SeedLinkMultiPool();
    this.setupPoolEvents();
    this.pool.startAll();

    // Iniciar ciclo de actualización periódica de delay y micro-sismos basales
    this.startBackgroundStationKeepalive();

    // Iniciar programador del 2° Simulacro Nacional (19 de Septiembre a las 12:00 PM CDMX)
    this.startNationalDrillScheduler();
  }

  public static getInstance(): SeedLinkService {
    if (!SeedLinkService.instance) {
      SeedLinkService.instance = new SeedLinkService();
    }
    return SeedLinkService.instance;
  }

  private loadStationsCatalog(): void {
    try {
      const candidates = [
        path.join(process.cwd(), 'stations.json'),
        path.join(process.cwd(), 'public', 'stations.json'),
        path.join(process.cwd(), 'desing', 'stations.json'),
      ];

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (Array.isArray(raw)) {
            for (const st of raw) {
              const codeUpper = (st.code || '').trim().toUpperCase();
              const fullUpper = (st.fullCode || '').trim().toUpperCase();
              if (
                EXCLUDED_STATIONS.has(codeUpper) ||
                EXCLUDED_STATIONS.has(fullUpper) ||
                st.work === false
              ) {
                continue;
              }
              this.stationsCatalog.set(codeUpper, st);
              const isRaspberry = isRaspberryShake(st.network);
              const matchingServer = SEEDLINK_SERVERS.find(
                (srv) => srv.stationCode === st.code || (srv.name && srv.name.toUpperCase() === st.code.toUpperCase())
              );
              const serverSource = matchingServer
                ? `${matchingServer.name} (${matchingServer.host}:${matchingServer.port})`
                : (isRaspberry ? 'Red AM OSOP' : 'ssn nunca muere (132.247.71.12:18000)');

              this.liveStates.set(st.code, {
                code: st.code,
                network: st.network || (isRaspberry ? 'AM' : 'IG'),
                fullCode: st.fullCode || `${st.network || (isRaspberry ? 'AM' : 'IG')}.${st.code}`,
                site: st.site || st.code,
                state: st.state || (isRaspberry ? 'Red Ciudadana UNAM' : ''),
                lat: Number(st.lat),
                lon: Number(st.lon),
                primaryChannel: st.primaryChannel || (isRaspberry ? 'EHZ' : 'BHZ'),
                acceleration: 0,
                accelerationStr: '—',
                amp: 0,
                ampStr: '—',
                status: 'Sin datos',
                delay: '—',
                delaySec: 0,
                pga: 0,
                pgaStr: '—',
                intensity: 0,
                lastPacketTime: null,
                staLtaRatio: 1.0,
                triggered: false,
                sampleRate: isRaspberry ? 100 : 20,
                packetCount: 0,
                serverSource: serverSource,
              });
            }
            console.log(`[SeedLinkService] Cargadas ${this.stationsCatalog.size} estaciones de stations.json`);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[SeedLinkService] Error cargando stations.json:', err);
    }
  }

  private setupPoolEvents(): void {
    this.pool.on('packet', ({ server, record }: PacketEventPayload) => {
      this.handleIncomingMiniSeedRecord(server.name, record);
    });

    this.pool.on('server_status_change', (status: SeedLinkServerStatus) => {
      this.broadcastWebSocket({
        type: 'seedlink_server_status',
        server: status,
        servers: this.pool.getAllStatuses(),
      });
    });
  }

  private handleIncomingMiniSeedRecord(serverName: string, record: MiniSeedRecord): void {
    if (!record || record.samples.length === 0) return;

    const cleanStation = record.station.trim().toUpperCase();
    const netUpper = (record.network || '').trim().toUpperCase();
    if (
      EXCLUDED_STATIONS.has(cleanStation) ||
      EXCLUDED_STATIONS.has(`${netUpper}.${cleanStation}`)
    ) {
      return;
    }

    const stMeta = this.stationsCatalog.get(cleanStation) || this.stationsCatalog.get(record.station);

    const KNOWN_COORDS: Record<string, { lat: number; lon: number; site: string; state: string; net: string }> = {
      EGUA: { lat: 14.63, lon: -90.51, site: 'Guatemala Central', state: 'Guatemala', net: 'TC' },
      ELI1: { lat: 13.34, lon: -88.18, site: 'San Miguel', state: 'El Salvador', net: 'TC' },
      QUEP: { lat: 9.43, lon: -84.16, site: 'Quepos', state: 'Costa Rica', net: 'TC' },
      TCS1: { lat: 9.93, lon: -84.08, site: 'San José', state: 'Costa Rica', net: 'TC' },
      UPAL: { lat: 10.90, lon: -85.02, site: 'Upala', state: 'Costa Rica', net: 'TC' },
      R1D8F: { lat: 12.14, lon: -86.27, site: 'Managua R1D8F', state: 'Nicaragua', net: 'AM' },
      R1E40: { lat: 12.13, lon: -86.25, site: 'Managua R1E40', state: 'Nicaragua', net: 'AM' },
      R4631: { lat: 12.15, lon: -86.27, site: 'Managua R4631', state: 'Nicaragua', net: 'AM' },
      R85D5: { lat: 11.95, lon: -85.95, site: 'Granada R85D5', state: 'Nicaragua', net: 'AM' },
      R8CCA: { lat: 12.44, lon: -86.88, site: 'León R8CCA', state: 'Nicaragua', net: 'AM' },
      RBAA6: { lat: 12.60, lon: -87.10, site: 'Chinandega RBAA6', state: 'Nicaragua', net: 'AM' },
      RD808: { lat: 11.44, lon: -85.83, site: 'Rivas RD808', state: 'Nicaragua', net: 'AM' },
      RE6B4: { lat: 13.09, lon: -86.36, site: 'Estelí RE6B4', state: 'Nicaragua', net: 'AM' },
      REB07: { lat: 12.92, lon: -85.92, site: 'Matagalpa REB07', state: 'Nicaragua', net: 'AM' },
      ESPN: { lat: 12.44, lon: -86.88, site: 'La Esperanza', state: 'Nicaragua', net: 'NU' },
      LPAZ: { lat: 14.80, lon: -90.20, site: 'La Paz', state: 'Guatemala', net: 'GT' },
      R1F53: { lat: 12.14, lon: -86.26, site: 'Managua R1F53', state: 'Nicaragua', net: 'AM' },
      VPS8: { lat: 10.20, lon: -84.23, site: 'Volcán Poás', state: 'Costa Rica', net: 'TC' },
      ICC1: { lat: 14.30, lon: -91.03, site: 'Santa Lucía', state: 'Guatemala', net: 'TC' },
      MA2: { lat: 59.57, lon: 150.77, site: 'Magadan', state: 'Rusia', net: 'IU' },
      CPM: { lat: 14.77, lon: -61.12, site: 'Carbet', state: 'Martinique', net: 'MQ' },
      MULD: { lat: 12.14, lon: -86.27, site: 'Mulukukú', state: 'Nicaragua', net: 'SX' },
      SIT: { lat: 57.06, lon: -135.33, site: 'Sitka', state: 'Alaska', net: 'AT' },
      JWT: { lat: 12.14, lon: -86.27, site: 'JWT Station', state: 'Nicaragua', net: 'JP' },
      SSPA: { lat: 40.64, lon: -77.89, site: 'Standing Stone', state: 'Penn, USA', net: 'IU' },
      // Estaciones Mexicanas (SSN, CICESE, Red Ciudadana UNAM, GSN)
      GTIG: { lat: 23.0669, lon: -99.1691, site: 'Gómez Farías', state: 'Tamaulipas', net: 'IG' },
      RE8BC: { lat: 19.3297, lon: -99.1781, site: 'UNAM Geofísica (RE8BC)', state: 'Ciudad de México', net: 'AM' },
      R4903: { lat: 19.3300, lon: -99.1800, site: 'UNAM Geofísica (R4903)', state: 'Ciudad de México', net: 'AM' },
      QUERE: { lat: 20.7030, lon: -100.4480, site: 'Campus Juriquilla (UNAM)', state: 'Querétaro', net: 'AM' },
      CPX: { lat: 32.4195, lon: -115.3050, site: 'Cerro Prieto (CICESE)', state: 'Baja California', net: 'BC' },
      SFX: { lat: 31.0376, lon: -114.8510, site: 'San Felipe (CICESE)', state: 'Baja California', net: 'BC' },
      CBX: { lat: 32.3131, lon: -116.6636, site: 'Cerro Bola (CICESE)', state: 'Baja California', net: 'BC' },
      SLBS: { lat: 23.6858, lon: -109.9443, site: 'Sierra La Laguna (GSN)', state: 'Baja California Sur', net: 'IU' },
      UNM: { lat: 19.3297, lon: -99.1781, site: 'Ciudad Universitaria (GEOSCOPE/UNAM)', state: 'Ciudad de México', net: 'G' },
      BAHB: { lat: 28.9440, lon: -113.5620, site: 'Bahía de los Ángeles (CICESE)', state: 'Baja California', net: 'RB' },
      // Estaciones de la Red Sísmica Nacional de Guatemala (INSIVUMEH - GI)
      AVCB: { lat: 15.4708, lon: -90.3708, site: 'Cobán', state: 'Alta Verapaz, Guatemala', net: 'GI' },
      AVCS: { lat: 15.8155, lon: -90.2766, site: 'Chisec', state: 'Alta Verapaz, Guatemala', net: 'GI' },
      CHIE: { lat: 14.5599, lon: -89.3414, site: 'Chiquimula / San José La Arada', state: 'Chiquimula, Guatemala', net: 'GI' },
      CHTG: { lat: 14.0833, lon: -90.3833, site: 'Chiquimulilla', state: 'Santa Rosa, Guatemala', net: 'GI' },
      CMSM: { lat: 14.7828, lon: -90.7937, site: 'Comitancillo', state: 'San Marcos, Guatemala', net: 'GI' },
      CQES: { lat: 14.5667, lon: -89.3500, site: 'Esquipulas', state: 'Chiquimula, Guatemala', net: 'GI' },
      ESSG: { lat: 13.9269, lon: -90.8211, site: 'Puerto San José', state: 'Escuintla, Guatemala', net: 'GI' },
      ESTQ: { lat: 14.1516, lon: -91.1941, site: 'Tiquisate', state: 'Escuintla, Guatemala', net: 'GI' },
      GCG4: { lat: 14.5833, lon: -90.5325, site: 'INSIVUMEH Sede Central', state: 'Guatemala, Guatemala', net: 'GI' },
      GUJV: { lat: 14.5461, lon: -90.4128, site: 'San José Pinula', state: 'Guatemala, Guatemala', net: 'GI' },
      GUMI: { lat: 14.6210, lon: -90.5990, site: 'Mixco', state: 'Guatemala, Guatemala', net: 'GI' },
      GUNB: { lat: 14.5957, lon: -90.3453, site: 'Nueva Santa Bárbara', state: 'Guatemala, Guatemala', net: 'GI' },
      GUSP: { lat: 14.5520, lon: -90.3168, site: 'San Pedro Ayampuc', state: 'Guatemala, Guatemala', net: 'GI' },
      GUVC: { lat: 14.5320, lon: -90.4980, site: 'Villa Canales', state: 'Guatemala, Guatemala', net: 'GI' },
      HUBA: { lat: 15.8166, lon: -91.2945, site: 'Santa Cruz Barillas', state: 'Huehuetenango, Guatemala', net: 'GI' },
      HUCU: { lat: 15.4078, lon: -91.9472, site: 'Cuilco', state: 'Huehuetenango, Guatemala', net: 'GI' },
      HUEH: { lat: 15.3182, lon: -91.5025, site: 'Huehuetenango Sede', state: 'Huehuetenango, Guatemala', net: 'GI' },
      HUHU: { lat: 15.3182, lon: -91.5030, site: 'Huehuetenango', state: 'Huehuetenango, Guatemala', net: 'GI' },
      IZAB: { lat: 15.7300, lon: -88.5843, site: 'Puerto Barrios (IZAB)', state: 'Izabal, Guatemala', net: 'GI' },
      IZLV: { lat: 15.5606, lon: -88.9077, site: 'Aldea Buenos Aires, Livingston', state: 'Izabal, Guatemala', net: 'GI' },
      IZPB: { lat: 15.7300, lon: -88.5840, site: 'Puerto Barrios', state: 'Izabal, Guatemala', net: 'GI' },
      IZRD: { lat: 15.6558, lon: -89.0017, site: 'Río Dulce, Livingston', state: 'Izabal, Guatemala', net: 'GI' },
      JAMO: { lat: 14.4956, lon: -89.8395, site: 'Monjas', state: 'Jalapa, Guatemala', net: 'GI' },
      JUAM: { lat: 14.3308, lon: -89.7108, site: 'Asunción Mita', state: 'Jutiapa, Guatemala', net: 'GI' },
      JUMO: { lat: 13.9881, lon: -90.0711, site: 'Montúfar, Moyuta', state: 'Jutiapa, Guatemala', net: 'GI' },
      PEPO: { lat: 16.3270, lon: -89.4170, site: 'Poptún', state: 'Petén, Guatemala', net: 'GI' },
      PETF: { lat: 16.9163, lon: -89.8667, site: 'Flores', state: 'Petén, Guatemala', net: 'GI' },
      PETP: { lat: 16.3268, lon: -89.4169, site: 'Poptún (PETP)', state: 'Petén, Guatemala', net: 'GI' },
      QCCJ: { lat: 15.4853, lon: -91.0347, site: 'Chajul', state: 'Quiché, Guatemala', net: 'GI' },
      QCIX: { lat: 16.0034, lon: -90.7772, site: 'Ixcán / Playa Grande', state: 'Quiché, Guatemala', net: 'GI' },
      QTQT: { lat: 14.8712, lon: -91.5143, site: 'Labor Ovalle, Quetzaltenango', state: 'Quetzaltenango, Guatemala', net: 'GI' },
      QUEO: { lat: 14.8872, lon: -91.5167, site: 'Olintepeque', state: 'Quetzaltenango, Guatemala', net: 'GI' },
      QUIS: { lat: 15.3211, lon: -91.1219, site: 'Sacapulas', state: 'Quiché, Guatemala', net: 'GI' },
      RECH: { lat: 14.2939, lon: -91.9146, site: 'Champerico', state: 'Retalhuleu, Guatemala', net: 'GI' },
      RERE: { lat: 14.5361, lon: -91.6778, site: 'Retalhuleu', state: 'Retalhuleu, Guatemala', net: 'GI' },
      RESA: { lat: 14.5822, lon: -91.5622, site: 'San Andrés Villa Seca', state: 'Retalhuleu, Guatemala', net: 'GI' },
      RETA: { lat: 14.5246, lon: -91.6949, site: 'Retalhuleu Sede (RETA)', state: 'Retalhuleu, Guatemala', net: 'GI' },
      SASJ: { lat: 14.4839, lon: -90.7122, site: 'San Juan Alotenango', state: 'Sacatepéquez, Guatemala', net: 'GI' },
      SMCA: { lat: 14.8565, lon: -92.0749, site: 'Catarina', state: 'San Marcos, Guatemala', net: 'GI' },
      SMOC: { lat: 14.5097, lon: -92.1931, site: 'Ocós', state: 'San Marcos, Guatemala', net: 'GI' },
      SMSP: { lat: 14.9650, lon: -91.7611, site: 'San Pedro Sacatepéquez', state: 'San Marcos, Guatemala', net: 'GI' },
      SOKI: { lat: 14.7411, lon: -91.1561, site: 'Panajachel / Sololá', state: 'Sololá, Guatemala', net: 'GI' },
      SRIX: { lat: 14.1717, lon: -90.4413, site: 'Ixpaco, Pueblo Nuevo Viñas', state: 'Santa Rosa, Guatemala', net: 'GI' },
      SROR: { lat: 14.2311, lon: -90.1984, site: 'Oratorio', state: 'Santa Rosa, Guatemala', net: 'GI' },
      SUCU: { lat: 14.5600, lon: -91.5570, site: 'Cuyotenango', state: 'Suchitepéquez, Guatemala', net: 'GI' },
      ZAES: { lat: 15.0028, lon: -89.5719, site: 'Estanzuela', state: 'Zacapa, Guatemala', net: 'GI' },
      BDG: { lat: 14.6280, lon: -90.6970, site: 'Barbacena', state: 'Sacatepéquez, Guatemala', net: 'GI' },
      // Estaciones de la Red Sísmica de El Salvador (MARN / SNET - SV)
      AERO: { lat: 13.4408, lon: -89.0556, site: 'Aeropuerto Monseñor Romero', state: 'La Paz, El Salvador', net: 'SV' },
      ALJI: { lat: 13.3197, lon: -88.5772, site: 'Jiquilisco / Puerto El Triunfo', state: 'Usulután, El Salvador', net: 'SV' },
      APOP: { lat: 13.8078, lon: -89.1789, site: 'Apopa', state: 'San Salvador, El Salvador', net: 'SV' },
      CALU: { lat: 13.7233, lon: -89.6586, site: 'Casa Maya, Caluco', state: 'Sonsonate, El Salvador', net: 'SV' },
      CEDA: { lat: 13.6989, lon: -89.1914, site: 'CEDART San Salvador', state: 'San Salvador, El Salvador', net: 'SV' },
      CEVE: { lat: 13.8267, lon: -89.6247, site: 'Cerro Verde', state: 'Santa Ana, El Salvador', net: 'SV' },
      CNRM: { lat: 13.7844, lon: -88.1250, site: 'Cantón La Rama', state: 'Morazán, El Salvador', net: 'SV' },
      COEB: { lat: 13.9286, lon: -89.5042, site: 'Lago de Coatepeque', state: 'Santa Ana, El Salvador', net: 'SV' },
      COEG: { lat: 13.9014, lon: -89.5425, site: 'Coatepeque El Guineo', state: 'Santa Ana, El Salvador', net: 'SV' },
      COMAC: { lat: 13.6361, lon: -89.3828, site: 'Comasagua', state: 'La Libertad, El Salvador', net: 'SV' },
      COTO: { lat: 14.3878, lon: -89.2158, site: 'Citalá / El Poy', state: 'Chalatenango, El Salvador', net: 'SV' },
      CPR: { lat: 14.1528, lon: -89.0417, site: 'Cerro Pelón', state: 'Chalatenango, El Salvador', net: 'SV' },
      ELCAR: { lat: 13.7167, lon: -88.9833, site: 'El Carmen', state: 'Cuscatlán, El Salvador', net: 'SV' },
      FAME: { lat: 13.8428, lon: -90.0175, site: 'San Francisco Menéndez', state: 'Ahuachapán, El Salvador', net: 'SV' },
      IGN: { lat: 13.7028, lon: -89.2006, site: 'Inst. Geográfico Nacional', state: 'San Salvador, El Salvador', net: 'SV' },
      INTP: { lat: 13.1972, lon: -88.0542, site: 'Intipucá', state: 'La Unión, El Salvador', net: 'SV' },
      JAYA: { lat: 13.6728, lon: -89.4439, site: 'Jayaque', state: 'La Libertad, El Salvador', net: 'SV' },
      JICA: { lat: 13.5111, lon: -89.5056, site: 'Jicalapa', state: 'La Libertad, El Salvador', net: 'SV' },
      JUCU: { lat: 13.5186, lon: -88.3847, site: 'Jucuapa', state: 'Usulután, El Salvador', net: 'SV' },
      LCNA: { lat: 13.3764, lon: -88.2250, site: 'La Canoa', state: 'San Miguel, El Salvador', net: 'SV' },
      LCND: { lat: 13.4014, lon: -88.5122, site: 'La Concordia', state: 'Usulután, El Salvador', net: 'SV' },
      LLGN: { lat: 13.6528, lon: -88.7514, site: 'Llano Grande', state: 'San Vicente, El Salvador', net: 'SV' },
      LOLO: { lat: 13.5542, lon: -88.3514, site: 'Lolotique', state: 'San Miguel, El Salvador', net: 'SV' },
      LOMA: { lat: 13.3917, lon: -87.8917, site: 'Loma Larga', state: 'La Unión, El Salvador', net: 'SV' },
      MAGT: { lat: 13.9250, lon: -89.8458, site: 'Magisterio', state: 'Ahuachapán, El Salvador', net: 'SV' },
      MTO3: { lat: 14.4194, lon: -89.3622, site: 'Cerro Montecristo', state: 'Santa Ana, El Salvador', net: 'SV' },
      NUBE: { lat: 13.6769, lon: -89.2800, site: 'Santa Tecla / Nube', state: 'La Libertad, El Salvador', net: 'SV' },
      NUGRA: { lat: 13.6014, lon: -88.4528, site: 'Nueva Granada', state: 'Usulután, El Salvador', net: 'SV' },
      P5NO: { lat: 13.9931, lon: -88.7564, site: 'Presa 5 de Noviembre', state: 'Cabañas, El Salvador', net: 'SV' },
      PACA: { lat: 13.5042, lon: -88.3361, site: 'Cerro El Pacayal', state: 'San Miguel, El Salvador', net: 'SV' },
      PAIS: { lat: 13.9728, lon: -89.2194, site: 'El Paisnal', state: 'San Salvador, El Salvador', net: 'SV' },
      PANC: { lat: 13.6139, lon: -89.1792, site: 'Panchimalco', state: 'San Salvador, El Salvador', net: 'SV' },
      PASA1: { lat: 13.5858, lon: -87.8417, site: 'Pasaquina', state: 'La Unión, El Salvador', net: 'SV' },
      PAVA: { lat: 13.7364, lon: -89.2872, site: 'Volcán San Salvador', state: 'San Salvador, El Salvador', net: 'SV' },
      PIC2: { lat: 13.7431, lon: -89.2556, site: 'El Picacho', state: 'San Salvador, El Salvador', net: 'SV' },
      PMON: { lat: 13.5353, lon: -88.2528, site: 'Moncagua', state: 'San Miguel, El Salvador', net: 'SV' },
      PQSS: { lat: 13.6806, lon: -89.1972, site: 'Parque Saburo Hirao', state: 'San Salvador, El Salvador', net: 'SV' },
      QUEZ: { lat: 13.8317, lon: -89.2742, site: 'Quezaltepeque', state: 'La Libertad, El Salvador', net: 'SV' },
      RANC: { lat: 14.0417, lon: -88.9417, site: 'San José Las Flores', state: 'Chalatenango, El Salvador', net: 'SV' },
      SANTO: { lat: 13.7144, lon: -88.8572, site: 'Santo Domingo', state: 'San Vicente, El Salvador', net: 'SV' },
      SAROG: { lat: 14.1681, lon: -89.4447, site: 'Santa Rosa Guachipilín', state: 'Santa Ana, El Salvador', net: 'SV' },
      SBLS: { lat: 13.4889, lon: -89.3361, site: 'San Blas', state: 'La Libertad, El Salvador', net: 'SV' },
      SCLA: { lat: 13.7014, lon: -88.7417, site: 'Santa Clara', state: 'San Vicente, El Salvador', net: 'SV' },
      SEM: { lat: 13.7250, lon: -88.8250, site: 'San Sebastián', state: 'San Vicente, El Salvador', net: 'SV' },
      SENPD: { lat: 13.8789, lon: -88.6322, site: 'Polideportivo Sensuntepeque', state: 'Cabañas, El Salvador', net: 'SV' },
      SENSU: { lat: 13.8742, lon: -88.6294, site: 'Sensuntepeque Centro', state: 'Cabañas, El Salvador', net: 'SV' },
      SJTE: { lat: 13.6264, lon: -89.0139, site: 'San Juan Tepezontes', state: 'La Paz, El Salvador', net: 'SV' },
      SLOR: { lat: 14.0278, lon: -89.7875, site: 'San Lorenzo', state: 'Ahuachapán, El Salvador', net: 'SV' },
      SNET: { lat: 13.6845, lon: -89.2361, site: 'SNET Sede Central', state: 'San Salvador, El Salvador', net: 'SV' },
      SNJE: { lat: 13.8403, lon: -89.0917, site: 'San José Guayabal', state: 'Cuscatlán, El Salvador', net: 'SV' },
      TECO: { lat: 13.5361, lon: -88.7847, site: 'Tecoluca', state: 'San Vicente, El Salvador', net: 'SV' },
      TEJUT: { lat: 14.1653, lon: -89.1214, site: 'Tejutla', state: 'Chalatenango, El Salvador', net: 'SV' },
      TESAK: { lat: 13.6458, lon: -89.1917, site: 'Museo Tesak', state: 'San Salvador, El Salvador', net: 'SV' },
      UDBS: { lat: 13.7144, lon: -89.1539, site: 'Universidad Don Bosco', state: 'San Salvador, El Salvador', net: 'SV' },
      UEES: { lat: 13.7089, lon: -89.2292, site: 'Univ. Evangélica El Salvador', state: 'San Salvador, El Salvador', net: 'SV' },
      UESS: { lat: 13.6931, lon: -89.2217, site: 'Univ. Evangélica Sur', state: 'San Salvador, El Salvador', net: 'SV' },
      UESV: { lat: 13.7194, lon: -89.2014, site: 'Univ. de El Salvador (UES)', state: 'San Salvador, El Salvador', net: 'SV' },
      UNIC: { lat: 13.6789, lon: -89.2514, site: 'Univ. José Matías Delgado I', state: 'La Libertad, El Salvador', net: 'SV' },
      UNICI: { lat: 13.6811, lon: -89.2486, site: 'Univ. José Matías Delgado II', state: 'La Libertad, El Salvador', net: 'SV' },
      UTEC: { lat: 13.6997, lon: -89.1978, site: 'Univ. Tecnológica El Salvador', state: 'San Salvador, El Salvador', net: 'SV' },
      VSM2: { lat: 13.4340, lon: -88.2710, site: 'Volcán San Miguel / Chaparrastique', state: 'San Miguel, El Salvador', net: 'SV' },
      ACABA: { lat: 13.9214, lon: -89.7892, site: 'ANP El Caballito', state: 'Ahuachapán, El Salvador', net: 'SV' },
      ARCE: { lat: 13.8406, lon: -89.4472, site: 'Ciudad Arce', state: 'La Libertad, El Salvador', net: 'SV' },
      FAGO: { lat: 13.6947, lon: -88.1067, site: 'San Francisco Gotera', state: 'Morazán, El Salvador', net: 'SV' },
      CNCH: { lat: 13.2764, lon: -87.8447, site: 'Volcán Conchagua', state: 'La Unión, El Salvador', net: 'SV' },
      // Estaciones de la Red Sísmica de Honduras (COPECO / UNAH - HN)
      TEG2: { lat: 14.0800, lon: -87.2100, site: 'Tegucigalpa Central', state: 'Francisco Morazán, Honduras', net: 'HN' },
      ROAT: { lat: 16.3200, lon: -86.5300, site: 'Roatán', state: 'Islas de la Bahía, Honduras', net: 'HN' },
      SPSH: { lat: 15.5000, lon: -88.0200, site: 'San Pedro Sula', state: 'Cortés, Honduras', net: 'HN' },
      LCEH: { lat: 15.7800, lon: -86.7900, site: 'La Ceiba', state: 'Atlántida, Honduras', net: 'HN' },
      COMA: { lat: 14.4500, lon: -87.6400, site: 'Comayagua', state: 'Comayagua, Honduras', net: 'HN' },
      CHOL: { lat: 13.3000, lon: -87.1900, site: 'Choluteca', state: 'Choluteca, Honduras', net: 'HN' },
      COPA: { lat: 14.8400, lon: -89.1600, site: 'Copán Ruinas', state: 'Copán, Honduras', net: 'HN' },
      TRUJ: { lat: 15.9200, lon: -85.9500, site: 'Trujillo', state: 'Colón, Honduras', net: 'HN' },
      STAB: { lat: 14.9200, lon: -88.2400, site: 'Santa Bárbara', state: 'Santa Bárbara, Honduras', net: 'HN' },
      JUTI: { lat: 14.6600, lon: -86.2200, site: 'Juticalpa', state: 'Olancho, Honduras', net: 'HN' },
      NACA: { lat: 13.5300, lon: -87.4900, site: 'Nacaome', state: 'Valle, Honduras', net: 'HN' },
      DANL: { lat: 14.0300, lon: -86.5800, site: 'Danlí', state: 'El Paraíso, Honduras', net: 'HN' },
      PLMP: { lat: 14.3800, lon: -87.6200, site: 'Palmerola', state: 'Comayagua, Honduras', net: 'HN' },
      GUAH: { lat: 14.5300, lon: -86.8200, site: 'Guaimaca', state: 'Francisco Morazán, Honduras', net: 'HN' },
      AMPH: { lat: 13.2900, lon: -87.6533, site: 'Amapala, Isla del Tigre', state: 'Valle, Honduras', net: 'HN' },
      CAJON: { lat: 14.9961, lon: -87.9714, site: 'Represa El Cajón', state: 'Cortés, Honduras', net: 'HN' },
      CHIHN: { lat: 15.1333, lon: -88.1667, site: 'Chinda', state: 'Santa Bárbara, Honduras', net: 'HN' },
      COMHN: { lat: 14.4589, lon: -87.6392, site: 'Comayagua Centro', state: 'Comayagua, Honduras', net: 'HN' },
      COPHN: { lat: 14.8394, lon: -89.1558, site: 'Copán Ruinas', state: 'Copán, Honduras', net: 'HN' },
      JUTIH: { lat: 14.6714, lon: -86.2167, site: 'Juticalpa Aguacate', state: 'Olancho, Honduras', net: 'HN' },
      MARCA: { lat: 14.1500, lon: -88.0333, site: 'Marcala', state: 'La Paz, Honduras', net: 'HN' },
      NISHN: { lat: 13.3333, lon: -87.6333, site: 'Isla Zacate Grande', state: 'Valle, Honduras', net: 'HN' },
      SONH: { lat: 15.6333, lon: -86.2667, site: 'Sonaguera', state: 'Colón, Honduras', net: 'HN' },
      SPSHN: { lat: 15.5344, lon: -88.0264, site: 'San Pedro Sula UNAH', state: 'Cortés, Honduras', net: 'HN' },
      YORHN: { lat: 15.1333, lon: -87.1333, site: 'Yoro Centro', state: 'Yoro, Honduras', net: 'HN' },
      TGUH: { lat: 14.0847, lon: -87.1656, site: 'Tegucigalpa UNAH', state: 'Francisco Morazán, Honduras', net: 'HN' },
    };

    const extra = KNOWN_COORDS[cleanStation];
    const resolvedNetwork = (stMeta?.network || extra?.net || record.network || 'AM').toUpperCase();
    const isRaspberry = isRaspberryShake(resolvedNetwork);

    // Desaturar la red AM: omitir canales secundarios (ENN, ENE) en Raspberry Shake (Item 31 & 32)
    // Para redes profesionales institucionales, se conservan los canales horizontales para análisis de onda S
    if (isRaspberry && (record.channel === 'ENN' || record.channel === 'ENE')) {
      return;
    }

    // Coordenadas geográficas estrictas: nunca inventar coordenadas (Item 30)
    const rawLat = stMeta?.lat !== undefined ? Number(stMeta.lat) : (extra ? extra.lat : NaN);
    const rawLon = stMeta?.lon !== undefined ? Number(stMeta.lon) : (extra ? extra.lon : NaN);
    if (isNaN(rawLat) || isNaN(rawLon)) {
      // Rechazar y salir: en un monitor público un default es peor que un error visible
      return;
    }

    // Filtro contra paquetes duplicados o fuera de secuencia de servidores redundantes
    const streamKey = `${resolvedNetwork}.${cleanStation}.${record.channel}`;
    const packetTimeMs = new Date(record.startTime.isoTime).getTime();
    if (!Number.isFinite(packetTimeMs) || packetTimeMs <= 0) {
      console.warn(`[SeedLinkService] Paquete descartado: timestamp inválido para ${resolvedNetwork}.${cleanStation}.${record.channel}`);
      return;
    }
    if (packetTimeMs > Date.now() + 30000) {
      console.warn(`[SeedLinkService] Paquete descartado: timestamp futuro para ${streamKey}`);
      return;
    }
    const lastPacketEndMs = this.streamLastPacketTime.get(streamKey) || 0;
    if (lastPacketEndMs > 0 && packetTimeMs < lastPacketEndMs) {
      // Ignorar paquetes atrasados o solapados para evitar duplicar energía en el DSP
      return;
    }
    const sampleRate = record.sampleRate || 20;
    const packetEndMs = packetTimeMs + (record.samples.length / sampleRate) * 1000;
    this.streamLastPacketTime.set(streamKey, packetEndMs);

    const isChanAccel =
      record.channel.startsWith('HN') ||
      record.channel.startsWith('EN') ||
      record.channel.startsWith('BN') ||
      (record.channel.length >= 2 && record.channel[1] === 'N');

    const chanPrefix2 = record.channel.slice(0, 2);
    const primaryChanMeta = stMeta?.channels?.find((c: any) => c.code === record.channel) ||
      stMeta?.channels?.find((c: any) => c.code && c.code.slice(0, 2) === chanPrefix2) || {
      code: record.channel,
      sensitivity: isChanAccel
        ? (isRaspberry ? 408000 : 400000)
        : (record.channel.startsWith('EH') || record.channel.startsWith('SH') || isRaspberry)
        ? 399650000
        : 628460000,
      inputType: isChanAccel ? 'ACCELERATION' : 'VELOCITY',
    };

    // Procesar con DSP
    const processed: ProcessedPacketResult = this.dsp.processSamples(
      resolvedNetwork,
      cleanStation,
      record.channel,
      sampleRate,
      record.startTime.isoTime,
      record.samples,
      primaryChanMeta
    );

    const now = Date.now();
    const delaySec = Math.max(0.1, Number(((now - packetTimeMs) / 1000).toFixed(1)));
    const delayStr = delaySec > 120 ? `${Math.round(delaySec / 60)}m` : `${delaySec.toFixed(1)}s`;

    // Item 15: Paquetes con más de 180s (3 minutos) de retraso corresponden a backfill / reconexión
    // No deben evaluarse como disparos en tiempo real
    const isBackfill = delaySec > 180;

    // Control de recepción: huecos, muestras planas o saltos de reloj bloquean el flujo para el detector
    const reception = this.receptionQc.observe({
      streamKey,
      packetStartMs: packetTimeMs,
      packetEndMs,
      prevEndMs: lastPacketEndMs,
      delaySec,
      samples: record.samples,
    });
    if (reception.transition) {
      const detail = reception.reasons.length > 0 ? `: ${reception.reasons.join('; ')}` : '';
      console.warn(`[SeedLinkService] Recepción ${reception.gate === 'BLOCKED' ? 'bloqueada' : 'restablecida'} en ${streamKey}${detail}`);
    }
    const receptionBlocked = reception.gate === 'BLOCKED';
    const effectiveTriggered = isBackfill || receptionBlocked ? false : processed.staLta.triggered;

    // Refinar la llegada P con AIC sobre la traza vertical; si el AIC no es confiable se usa el cruce STA/LTA
    let refinedPickIso: string | null = null;
    if (record.channel.toUpperCase().endsWith('Z')) {
      let onsetBuffer = this.onsetBuffers.get(streamKey);
      if (!onsetBuffer) {
        onsetBuffer = new OnsetBuffer();
        this.onsetBuffers.set(streamKey, onsetBuffer);
      }
      onsetBuffer.append(packetTimeMs, sampleRate, record.samples);
      const crossingMs = processed.staLta.triggerTimeIso ? new Date(processed.staLta.triggerTimeIso).getTime() : NaN;
      if (processed.staLta.triggered && !isBackfill && !receptionBlocked && Number.isFinite(crossingMs)) {
        const pickMs = onsetBuffer.refineOnset(crossingMs);
        if (pickMs !== null) refinedPickIso = new Date(pickMs).toISOString();
      }
    }

    // Amplitud máxima en esta trama
    let maxAmp = 0;
    for (let i = 0; i < record.samples.length; i++) {
      const a = Math.abs(record.samples[i]);
      if (a > maxAmp) maxAmp = a;
    }

    // Actualizar estado vivo de la estación con métricas físicas reales
    let state = this.liveStates.get(cleanStation) || this.liveStates.get(record.station);
    if (!state) {
      state = {
        code: cleanStation,
        network: resolvedNetwork,
        fullCode: `${resolvedNetwork}.${cleanStation}`,
        site: stMeta?.site || extra?.site || cleanStation,
        state: stMeta?.state || extra?.state || '',
        lat: rawLat,
        lon: rawLon,
        primaryChannel: record.channel,
        acceleration: processed.pga,
        accelerationStr: processed.pgaStr,
        amp: processed.amplitudePhysical,
        ampUnit: processed.amplitudeUnit,
        ampStr: processed.amplitudeStr,
        status: effectiveTriggered ? 'Disparo STA/LTA' : (receptionBlocked ? 'Recepción degradada' : (isBackfill ? 'Recuperando traza' : 'Recibiendo')),
        delay: delayStr,
        delaySec,
        pga: processed.pga,
        pgaStr: processed.pgaStr,
        intensity: processed.intensityMMI,
        lastPacketTime: processed.endTime,
        lastReceivedWallTime: now,
        staLtaRatio: processed.staLta.ratio,
        triggered: effectiveTriggered,
        sampleRate,
        packetCount: 1,
        serverSource: serverName,
        noiseClass: processed.noise.noiseClass,
      };
      this.liveStates.set(cleanStation, state);
    } else {
      state.network = resolvedNetwork;
      state.fullCode = `${resolvedNetwork}.${cleanStation}`;
      const isNewHighRate = record.channel.startsWith('HH') || record.channel.startsWith('EH') || record.channel.startsWith('HN') || (record.sampleRate && record.sampleRate >= 50);
      const isCurrentLowRate = (!state.primaryChannel || state.primaryChannel.startsWith('BH') || (state.sampleRate && state.sampleRate < 50));
      if (isNewHighRate || isCurrentLowRate) {
        state.primaryChannel = record.channel;
        state.sampleRate = record.sampleRate || state.sampleRate;
      }
      state.lat = rawLat;
      state.lon = rawLon;
      state.acceleration = processed.pga;
      state.accelerationStr = processed.pgaStr;
      state.amp = processed.amplitudePhysical;
      state.ampUnit = processed.amplitudeUnit;
      state.ampStr = processed.amplitudeStr;
      state.status = effectiveTriggered ? 'Disparo STA/LTA' : (receptionBlocked ? 'Recepción degradada' : (isBackfill ? 'Recuperando traza' : 'Recibiendo'));
      state.delay = delayStr;
      state.delaySec = delaySec;
      state.pga = processed.pga;
      state.pgaStr = processed.pgaStr;
      state.intensity = processed.intensityMMI;
      state.lastPacketTime = processed.endTime;
      state.lastReceivedWallTime = now;
      state.staLtaRatio = processed.staLta.ratio;
      state.triggered = effectiveTriggered;
      state.sampleRate = record.sampleRate || state.sampleRate;
      state.packetCount++;
      state.serverSource = serverName;
      state.noiseClass = processed.noise.noiseClass;
    }

    // Solo alimentar el detector sismológico con datos en tiempo real (< 180s de delay)
    // Se procesan todos los componentes reales; los canales verticales fijan tP y los horizontales aportan PGA máximo
    if (!isBackfill && !receptionBlocked) {
      this.detector.processStationTelemetry({
        station: cleanStation,
        network: state.network,
        channel: record.channel,
        lat: state.lat,
        lon: state.lon,
        site: state.site,
        stateName: state.state,
        pga: processed.pga,
        amp: processed.amplitudePhysical,
        staLtaRatio: processed.staLta.peakRatio || processed.staLta.ratio,
        sampleRate,
        packetStartTime: processed.startTime,
        isPureFrequencySeismic: processed.isPureFrequencySeismic,
        freqDominantHz: processed.freqDominantHz,
        highFreqRatio: processed.highFreqRatio,
        woodAndersonDispMm: processed.woodAndersonDispMm,
        triggered: processed.staLta.triggered,
        triggerSampleIndex: processed.staLta.triggerSampleIndex,
        triggerTimeIso: processed.staLta.triggerTimeIso,
        refinedPickIso,
        minPgaThreshold: processed.staLta.minPgaGal,
        noiseClass: processed.noise.noiseClass,
      });
    } else {
      // Backfill histórico (> 180s de retraso) o flujo con recepción bloqueada: limpiar cualquier disparo retenido
      this.detector.clearStationTrigger(cleanStation);
    }

    // Agregar puntos al buffer de oscilograma (Swarm Waveform Buffer)
    this.appendWaveformPoints(cleanStation, processed, record.samples);

    // Determinar si esta estación es observada activamente en el visor SWARM o está en evento
    const isActiveSwarm = this.activeSwarmStations.has(cleanStation) ||
                          this.activeSwarmStations.has(cleanStation.toUpperCase()) ||
                          this.activeSwarmStations.has(state.code) ||
                          effectiveTriggered;

    // Transmitir por WebSocket
    this.broadcastWebSocket({
      type: 'seismic_data',
      station: cleanStation,
      network: record.network,
      channel: record.channel,
      startTime: processed.startTime,
      endTime: processed.endTime,
      sampleRate: record.sampleRate,
      pga: processed.pga,
      pgaStr: processed.pgaStr,
      amp: processed.amplitudePhysical,
      ampUnit: processed.amplitudeUnit,
      ampStr: processed.amplitudeStr,
      delay: delayStr,
      delaySec,
      intensity: processed.intensityMMI,
      staLta: processed.staLta,
      noiseClass: processed.noise.noiseClass,
      status: state.status,
      serverSource: serverName,
      // Solo serializar muestras pesadas en Gal si la estación está activa en el visor SWARM o disparada
      accelSamples: isActiveSwarm ? Array.from(processed.accelerationGal) : undefined,
      rawSamples: isActiveSwarm ? Array.from(record.samples) : undefined,
      samplesPreview: Array.from(record.samples.slice(0, 30)),
    });
  }

  private appendWaveformPoints(station: string, processed: ProcessedPacketResult, rawSamples: Int32Array | Float32Array): void {
    let buf = this.waveformBuffers.get(station);
    if (!buf) {
      buf = [];
      this.waveformBuffers.set(station, buf);
    }

    const count = rawSamples.length;
    const startMs = new Date(processed.startTime).getTime();
    const dtMs = count > 0 ? (1000 / (processed.sampleRate || 20)) : 50;

    for (let i = 0; i < count; i++) {
      const ptTime = new Date(startMs + i * dtMs).toISOString();
      buf.push({
        time: ptTime,
        count: rawSamples[i],
        accelGal: processed.accelerationGal[i] || 0,
      });
    }

    if (buf.length > this.maxBufferPoints) {
      buf.splice(0, buf.length - this.maxBufferPoints);
    }
  }

  /**
   * Monitorea la latencia y tiempo de inactividad de estaciones que han recibido datos
   */
  private startBackgroundStationKeepalive(): void {
    if (this.backgroundInterval) clearInterval(this.backgroundInterval);

    this.backgroundInterval = setInterval(() => {
      const now = Date.now();
      let updatedAny = false;

      this.liveStates.forEach((state) => {
        // Solo evaluar estaciones que hayan recibido paquetes de datos del servidor
        if (state.packetCount > 0 && state.lastPacketTime) {
          const lastMs = new Date(state.lastPacketTime).getTime();
          const diffSec = Math.max(0, (now - lastMs) / 1000);
          const delaySec = Math.round(diffSec);
          state.delay = delaySec > 120 ? `${Math.round(delaySec / 60)}m` : `${delaySec}s`;
          state.delaySec = delaySec;

          // Liveness check basado en cuándo llegó la última trama TCP a nuestro servidor (lastReceivedWallTime)
          const wallElapsedSec = state.lastReceivedWallTime
            ? Math.max(0, (now - state.lastReceivedWallTime) / 1000)
            : diffSec;

          // Si hace más de 90s que no llega ninguna trama TCP, la estación se marca como 'Sin datos'
          if (wallElapsedSec > 90) {
            if (state.status !== 'Sin datos') {
              state.triggered = false;
              state.pga = 0;
              state.pgaStr = '—';
              state.acceleration = 0;
              state.accelerationStr = '—';
              state.intensity = 0;
              state.staLtaRatio = 1.0;
              state.status = 'Sin datos';
              this.detector.clearStationTrigger(state.code);
              updatedAny = true;
            }
          } else if (wallElapsedSec > 8 && state.triggered) {
            // Si la estación estaba disparada pero cesó el evento en la traza, volver visualmente a reposo
            state.triggered = false;
            state.status = 'Recibiendo';
            if (wallElapsedSec > 60) {
              this.detector.clearStationTrigger(state.code);
            }
            updatedAny = true;
          } else if (wallElapsedSec > 8 && state.pga > 0.02) {
            // Si no llegan paquetes en > 8s, decaer progresivamente la aceleración hacia reposo
            state.pga = Number((state.pga * 0.70).toFixed(4));
            if (state.pga < 0.01) {
              state.pga = 0.000;
              state.intensity = 0;
            }
            state.acceleration = state.pga;
            state.pgaStr = `${state.pga.toFixed(3)} gal`;
            state.accelerationStr = state.pgaStr;
            updatedAny = true;
          }
        }
      });

      if (updatedAny && this.wss && this.wss.clients.size > 0) {
        this.broadcastWebSocket({
          type: 'station_batch_update',
          stations: this.getAllStationStates(),
        });
      }

      // Latido de sincronización del servidor cada ~10s con el identificador de arranque para refresco de clientes
      if (now % 10000 < 2000 && this.wss && this.wss.clients.size > 0) {
        this.broadcastWebSocket({
          type: 'server_heartbeat',
          serverBootId: this.serverBootId,
          serverStartTime: this.serverStartTime,
          timestamp: now,
        });
      }
    }, 2000);
  }

  public attachWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;

    wss.on('connection', (ws: WebSocket) => {
      // Enviar estado de servidores, estaciones, catálogo histórico y versión de arranque del servidor
      ws.send(JSON.stringify({
        type: 'initial_state',
        serverBootId: this.serverBootId,
        serverStartTime: this.serverStartTime,
        servers: this.pool.getAllStatuses(),
        stations: Array.from(this.liveStates.values()),
        events: this.detector.getEarthquakeHistory(),
        tsunamiAlert: this.activeTsunamiAlert,
      }));

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'get_waveform' && data.station) {
            const clean = data.station.includes('.') ? data.station.split('.').pop()! : data.station;
            this.activeSwarmStations.add(clean);
            this.activeSwarmStations.add(clean.toUpperCase());
            const buf = this.getStationWaveform(data.station);
            ws.send(JSON.stringify({
              type: 'station_waveform',
              station: data.station,
              waveform: buf,
            }));
          } else if (data.type === 'set_active_station' && data.station) {
            const clean = data.station.includes('.') ? data.station.split('.').pop()! : data.station;
            this.activeSwarmStations.clear();
            this.activeSwarmStations.add(clean);
            this.activeSwarmStations.add(clean.toUpperCase());
          } else if (data.type === 'clear_active_station') {
            this.activeSwarmStations.clear();
          } else if (data.type === 'reconnect_server' && data.serverId) {
            this.pool.reconnectServer(data.serverId);
          } else if (data.type === 'reconnect_all') {
            this.pool.reconnectAll();
          }
        } catch (_) {}
      });
    });
  }

  public broadcastWebSocket(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  /**
   * Difunde una orden de refresco inmediato a todos los clientes web conectados
   */
  public broadcastClientReload(reason = 'server_update'): void {
    console.log(`[SeedLinkService] Difundiendo orden de recarga a todos los clientes web (Razón: ${reason})...`);
    this.broadcastWebSocket({
      type: 'reload_clients',
      reason,
      serverBootId: this.serverBootId,
      serverStartTime: this.serverStartTime,
      timestamp: Date.now(),
    });
  }

  public getActiveTsunamiAlert(): any | null {
    return this.activeTsunamiAlert;
  }

  public emitTsunamiAlert(alert: any): any {
    const payload = {
      id: alert.id || `tsunami_${Date.now()}`,
      active: true,
      issuedAt: alert.issuedAt || new Date().toISOString(),
      type: alert.type || 'ALERTA DE TSUNAMI',
      bulletinNumber: alert.bulletinNumber || 1,
      epicenter: alert.epicenter || {
        lat: 14.85,
        lon: -93.80,
        location: 'Costa de Chiapas',
        magnitude: 7.8,
        depthKm: 20,
      },
      zones: alert.zones || {},
      zoneDetails: alert.zoneDetails || {},
      maxWaveHeight: alert.maxWaveHeight || '1.5 - 3.5 m',
      instructions: alert.instructions || 'Alejarse inmediatamente de playas y zonas costeras bajas. Evacuar a zonas altas o pisos superiores.',
      source: alert.source || 'Centro de Alerta de Tsunamis (CAT) / Panel de Administración',
    };

    this.activeTsunamiAlert = payload;
    console.log(`[SeedLinkService] 🌊 ALERTA DE TSUNAMI ACTIVADA: ${payload.type} (Mag: ${payload.epicenter?.magnitude || 'N/A'}, Zonas en alerta: ${Object.keys(payload.zones).length})`);

    this.broadcastWebSocket({
      type: 'tsunami_alert',
      alert: this.activeTsunamiAlert,
      timestamp: Date.now(),
    });

    return this.activeTsunamiAlert;
  }

  public stopTsunamiAlert(): void {
    console.log('[SeedLinkService] 🌊 ALERTA DE TSUNAMI CANCELADA/DETENIDA.');
    this.activeTsunamiAlert = null;
    this.broadcastWebSocket({
      type: 'tsunami_stop',
      timestamp: Date.now(),
    });
  }

  public getServersStatus(): SeedLinkServerStatus[] {
    return this.pool.getAllStatuses();
  }

  public getAllStationStates(): LiveStationState[] {
    return Array.from(this.liveStates.values());
  }

  public getStationState(stationCode: string): LiveStationState | undefined {
    if (!stationCode) return undefined;
    const clean = stationCode.includes('.') ? stationCode.split('.').pop()! : stationCode;
    return this.liveStates.get(clean) ||
           this.liveStates.get(clean.toUpperCase()) ||
           this.liveStates.get(stationCode);
  }

  public getStationWaveform(stationCode: string): WaveformPoint[] {
    if (!stationCode) return [];
    const clean = stationCode.includes('.') ? stationCode.split('.').pop()! : stationCode;
    return this.waveformBuffers.get(clean) ||
           this.waveformBuffers.get(clean.toUpperCase()) ||
           this.waveformBuffers.get(stationCode) || [];
  }

  public reconnectServer(serverId?: string): void {
    if (serverId) {
      this.pool.reconnectServer(serverId);
    } else {
      this.pool.reconnectAll();
    }
  }

  public getDetector(): SeismicDetectorEngine {
    return this.detector;
  }

  public getEarthquakeHistory() {
    return this.detector.getEarthquakeHistory();
  }

  public isMonitorHistoryReady(): boolean {
    return this.detector.isMonitorHistoryReady();
  }

  /** Perfiles de ruido calibrados por canal (clase, umbrales aprendidos, penalización y cuarentena) */
  public getNoiseProfiles(station?: string) {
    const snapshot = NoiseCalibrator.getInstance().getSnapshot();
    const code = (station || '').trim().toUpperCase();
    return code ? snapshot.filter((s) => s.station === code) : snapshot;
  }

  /** Borra el perfil de ruido de una estación para recalibrarla desde cero */
  public resetNoiseProfile(station: string): number {
    return NoiseCalibrator.getInstance().resetStation(station);
  }

  public flushNoiseProfiles(): void {
    NoiseCalibrator.getInstance().flush();
  }

  public broadcastSismosMpSignal(payload: { code?: string; message?: string; source?: string; raw?: string }): any {
    const code = payload.code || 'wawa';
    const message = payload.message || 'sismosMP activo';
    const source = payload.source || 'SismosMP';
    const nowIso = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString('es-MX');

    console.log(`[SismosMP] 📡 SEÑAL EXTERNA RECIBIDA: Código="${code}" | Mensaje="${message}" | Origen="${source}" a las ${timeStr}`);

    const broadcastData = {
      type: 'sismosmp_signal',
      code,
      message,
      source,
      timestamp: nowIso,
      timeStr,
      raw: payload.raw || null,
    };

    this.broadcastWebSocket(broadcastData);

    return broadcastData;
  }

  /**
   * Ciclo de monitoreo de tiempo para el 2° Simulacro Nacional (19 de Septiembre, 12:00:00 PM CDMX)
   * Emite logs cada hora que pasa hacia el simulacro
   */
  private startNationalDrillScheduler(): void {
    if (this.nationalDrillInterval) {
      clearInterval(this.nationalDrillInterval);
    }

    let lastLoggedHour = -1;
    let lastLoggedMinute = -1;

    // Log inicial del estado del simulacro
    const initialStatus = this.getNationalDrillStatus();
    console.log('\x1b[36m%s\x1b[0m', `[2° Simulacro Nacional 19 Sep] 🗓️ Programador activo para el 19 de Septiembre a las 12:00 PM CDMX.`);
    console.log(`[2° Simulacro Nacional 19 Sep] ⏰ Hora CDMX: ${initialStatus.currentCdmxTime} | Faltan aprox: ${initialStatus.formattedCountdown} (Audio: meow.mp3 de duración natural)`);

    this.nationalDrillInterval = setInterval(() => {
      try {
        const now = new Date();
        const dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Mexico_City',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: false,
        });
        const parts = dtf.formatToParts(now);
        const m: Record<string, number> = {};
        for (const p of parts) {
          if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
        }

        const month = m.month;             // 9 = Septiembre
        const day = m.day;                 // 19
        const hour = m.hour === 24 ? 0 : m.hour; // 0 a 23
        const minute = m.minute;           // 00 a 59
        const second = m.second;           // 00 a 59

        // 1. Log cada hora que pasa (al cambiar de hora o al minuto 0)
        if (month === 9 && day === 19 && hour < 12) {
          if (hour !== lastLoggedHour && minute === 0 && second <= 3) {
            lastLoggedHour = hour;
            const hoursRemaining = 12 - hour;
            const cdmxTimeStr = now.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour12: true });
            console.log('\x1b[33m%s\x1b[0m', `═══════════════════════════════════════════════════════════════════`);
            console.log('\x1b[1m\x1b[33m%s\x1b[0m', `  ⏳ [2° SIMULACRO NACIONAL 19 SEP] FALTAN ${hoursRemaining} HORA(S)`);
            console.log(`  • Hora actual en CDMX: ${cdmxTimeStr}`);
            console.log(`  • Hora del Simulacro:  12:00:00 PM CDMX (Alarma meow.mp3)`);
            console.log('\x1b[33m%s\x1b[0m', `═══════════════════════════════════════════════════════════════════`);
          }

          // Logs en los últimos 30, 15, 10, 5 y 1 minutos previos al simulacro
          if (hour === 11) {
            const keyMinutes = [30, 45, 50, 55, 59];
            if (keyMinutes.includes(minute) && minute !== lastLoggedMinute && second <= 3) {
              lastLoggedMinute = minute;
              const remaining = 60 - minute;
              console.log('\x1b[35m%s\x1b[0m', `[2° Simulacro Nacional 19 Sep] ⚠️ ¡ATENCIÓN! Faltan ${remaining} minuto(s) para el Simulacro Nacional (12:00 PM CDMX)`);
            }
          }
        }

        // 2. Activación exacta a las 12:00:00 PM CDMX
        if (month === 9 && day === 19 && hour === 12 && minute === 0 && second <= 6) {
          if (!this.hasTriggeredNationalDrill) {
            this.hasTriggeredNationalDrill = true;
            console.log('\x1b[31m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
            console.log('\x1b[1m\x1b[31m%s\x1b[0m', '  🚨 INICIANDO EL SEGUNDO SIMULACRO NACIONAL 2026 (12:00 PM CDMX)');
            console.log('\x1b[31m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
            this.triggerNationalDrill(60);
          }
        }

        // Restablecer bandera si ya pasó la hora
        if (hour !== 12 || day !== 19) {
          if (this.hasTriggeredNationalDrill && (hour > 12 || day !== 19)) {
            this.hasTriggeredNationalDrill = false;
          }
        }
      } catch (err) {
        console.error('[NationalDrillScheduler] Error en verificación de hora:', err);
      }
    }, 1000);
  }

  /**
   * Dispara el 2° Simulacro Nacional hacia todos los navegadores conectados
   */
  public triggerNationalDrill(customDuration: number = 60): any {
    const duracion = customDuration || 60;
    const tipo = '2° SIMULACRO NACIONAL 19 SEP';
    const nivel = 'MODERADA';
    const estados = [
      'CDMX', 'Guerrero', 'Oaxaca', 'Puebla', 'Morelos',
      'Michoacán', 'Jalisco', 'Colima', 'Veracruz', 'Chiapas',
      'Tlaxcala', 'Edomex'
    ];

    console.log(`[SeedLinkService] 🚨 [SIMULACRO NACIONAL] Emitiendo señal de Simulacro Nacional a todos los clientes (Duración: ${duracion}s, Audio: meow.mp3)`);

    const broadcastData = {
      type: 'trigger_alerta_sismica',
      duracion,
      tipo,
      nivel,
      estados,
      simulacroNacional: true,
      audio: 'meow.mp3',
      timestamp: new Date().toISOString(),
    };

    this.broadcastWebSocket(broadcastData);
    return broadcastData;
  }

  /**
   * Obtiene información y cuenta regresiva del 2° Simulacro Nacional
   */
  public getNationalDrillStatus(): any {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = dtf.formatToParts(now);
    const m: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
    }
    const currentYear = m.year;
    const currentMonth = m.month;
    const currentDay = m.day;

    // Fecha objetivo: 19 de Septiembre del año en curso a las 12:00:00 PM CDMX (UTC-6)
    const targetEpochMs = new Date(`${currentYear}-09-19T12:00:00-06:00`).getTime();
    const diffMs = targetEpochMs - now.getTime();
    const secondsRemaining = Math.max(0, Math.floor(diffMs / 1000));
    const isPastToday = diffMs < 0 && currentDay === 19 && currentMonth === 9;

    return {
      title: `2° Simulacro Nacional ${currentYear}`,
      scheduledDate: '19 de Septiembre',
      scheduledTime: '12:00:00 PM (Hora Centro de México)',
      timeZone: 'America/Mexico_City (UTC-6)',
      currentCdmxTime: now.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour12: true }),
      currentCdmxDate: now.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' }),
      secondsRemaining,
      formattedCountdown: this.formatSecondsCountdown(secondsRemaining),
      hasTriggeredToday: this.hasTriggeredNationalDrill,
      isPastToday,
      duracion: 60,
      tipo: '2° SIMULACRO NACIONAL 19 SEP',
      nivel: 'MODERADA',
      audio: 'meow.mp3',
      estadosParticipantes: [
        'CDMX', 'Guerrero', 'Oaxaca', 'Puebla', 'Morelos',
        'Michoacán', 'Jalisco', 'Colima', 'Veracruz', 'Chiapas',
        'Tlaxcala', 'Edomex'
      ],
    };
  }

  private formatSecondsCountdown(totalSeconds: number): string {
    if (totalSeconds <= 0) return '00:00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Obtiene la lista de sismos activos con IDs legibles y tiempo transcurrido
   */
  public getActiveEarthquakes(): any[] {
    return this.detector.getActiveEarthquakes().map((e) => ({
      id: e.id,
      displayId: e.displayId || generateDisplayId(e.id),
      magnitude: e.magnitude,
      location: e.location,
      depth: e.depth,
      status: e.status,
      time: e.time,
      timeEpoch: e.timeEpoch,
      elapsedSec: Math.max(0, Math.round((Date.now() - (e.timeEpoch || Date.now())) / 1000)),
    }));
  }

  /**
   * Cancela o desconfirma un sismo activo por ID/código y transmite la orden y el sonido de desconfirmación (desconfirmacion.mp3)
   */
  public cancelActiveEarthquake(identifier?: string): {
    cancelled: boolean;
    eventId?: string;
    displayId?: string;
    location?: string;
    magnitude?: number;
    count: number;
    message: string;
  } {
    const res = this.detector.cancelEarthquake(identifier);
    const eventId = res.event?.id || identifier || null;
    const displayId = res.event?.displayId || (res.event ? generateDisplayId(res.event.id) : (identifier || ''));

    console.log(`[SeedLinkService] 🛑 ORDEN DE CANCELACIÓN: Sismo ID=${eventId} [${displayId}]. Notificando 'earthquake_cancelled' (desconfirmacion.mp3) a clientes.`);

    // Transmitir orden a todos los clientes WebSocket para detener el sismo y reproducir desconfirmacion.mp3
    this.broadcastWebSocket({
      type: 'earthquake_cancelled',
      eventId,
      displayId,
      audio: 'desconfirmacion.mp3',
      message: res.message,
      cancelledAt: new Date().toISOString(),
    });

    return {
      cancelled: res.cancelled,
      eventId: res.event?.id,
      displayId,
      location: res.event?.location,
      magnitude: res.event?.magnitude,
      count: res.count,
      message: res.message,
    };
  }

  public clearEarthquakeHistory(): void {
    this.detector.clearEarthquakeHistory();
    this.broadcastWebSocket({
      type: 'earthquake_history_cleared',
    });
  }

  public disconnect(): void {
    if (this.nationalDrillInterval) {
      clearInterval(this.nationalDrillInterval);
      this.nationalDrillInterval = null;
    }
    this.pool.destroy();
    this.flushNoiseProfiles();
  }
}
