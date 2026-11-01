/**
 * POOL MULTI-SERVIDOR SEEDLINK CON TIMEOUT ESTRICTO DE 20S
 * Mantiene conexiones TCP simultáneas a los 25 servidores especificados,
 * monitoreando su estado (Done / Network error: Connect timed out),
 * extrayendo tramas MiniSEED y reintentando automáticamente de forma persistente.
 */

import net from 'net';
import { EventEmitter } from 'events';
import { SEEDLINK_SERVERS, SeedLinkServerDefinition, SeedLinkServerStatus } from './server-list';
import { parseMiniSeedRecord, MiniSeedRecord } from './miniseed';

const SL_MAGIC = Buffer.from('SL');

/**
 * Estaciones expresamente excluidas de conexión SeedLink (Isla Socorro H06E y SV.TECD)
 */
export const EXCLUDED_SEEDLINK_STATIONS = new Set<string>([
  'H06E',
  'TECD',
  'IG.H06E',
  'SV.TECD'
]);

export interface PacketEventPayload {
  server: SeedLinkServerDefinition;
  record: MiniSeedRecord;
}

export class SeedLinkWorker extends EventEmitter {
  public server: SeedLinkServerDefinition;
  public status: string = 'Connecting...';
  public packetsReceived: number = 0;
  public bytesReceived: number = 0;
  public bitrateKbps: number = 0;
  public lastPacketTime: string | null = null;
  public serverVersion: string = '';

  private socket: net.Socket | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private handshakeBuffer = '';
  private handshakeState: 'IDLE' | 'HELLO' | 'AWAIT_STATION_OK' | 'AWAIT_SELECT_OK' | 'AWAIT_DATA_OK' | 'STREAMING' = 'IDLE';
  private stationQueue: Array<{ code: string; net: string }> = [];
  private currentStation: { code: string; net: string } | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private bytesInWindow: number = 0;
  private bitrateInterval: NodeJS.Timeout | null = null;
  private isDestroyed: boolean = false;

  constructor(server: SeedLinkServerDefinition) {
    super();
    this.server = server;
  }

  public start(): void {
    this.isDestroyed = false;
    this.connect(false);
    this.startBitrateMeter();
  }

  public connect(force: boolean = false): void {
    if (this.isDestroyed) return;

    // Si ya está conectado y con socket activo, NO destruir ni reconectar:
    // Se debe mantener suscrito al servidor permanentemente
    if (!force && this.status === 'Done' && this.socket && !this.socket.destroyed) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (_) {}
      this.socket = null;
    }

    this.status = 'Connecting...';
    this.handshakeState = 'IDLE';
    this.stationQueue = [];
    this.currentStation = null;
    this.rxBuffer = Buffer.alloc(0);
    this.handshakeBuffer = '';

    const socket = new net.Socket();
    this.socket = socket;

    // Timeout estricto de 20 segundos SOLO para la fase de establecimiento de conexión TCP
    const timeoutMs = (this.server.timeoutSec || 20) * 1000;
    socket.setTimeout(timeoutMs);

    // Temporizador de conexión: si tras 20s no conecta, marcar timeout y destruir socket
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.status === 'Connecting...') {
        this.status = 'Network error: Connect timed out';
        this.emit('status_change', this.getStatus());
        try {
          socket.destroy();
        } catch (_) {}
      }
    }, timeoutMs);

    socket.connect(this.server.port, this.server.host, () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }

      // Mantener timeout durante el handshake; se desactiva al comenzar el streaming.
      // TCP keep-alive evita conexiones muertas durante silencios sísmicos.
      socket.setKeepAlive(true, 15000);

      this.status = 'Handshaking...';
      this.emit('status_change', this.getStatus());
      this.emit('server_connected', { server: this.server });

      // Iniciar Handshake: paso 1 HELLO
      this.handshakeState = 'HELLO';
      try {
        socket.write('HELLO\r\n');
      } catch (_) {}
    });

    socket.on('data', (chunk: Buffer) => {
      this.bytesReceived += chunk.length;
      this.bytesInWindow += chunk.length;

      if (this.handshakeState !== 'STREAMING') {
        this.handleHandshake(chunk);
      } else {
        this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
        this.processPacketBuffer();
      }
    });

    socket.on('timeout', () => {
      if (this.status !== 'Done') {
        this.status = 'Network error: Connect timed out';
        this.emit('status_change', this.getStatus());
        try {
          socket.destroy();
        } catch (_) {}
      }
    });

    socket.on('error', (err: any) => {
      const msg = err && err.message ? String(err.message) : 'null';
      if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
        this.status = 'Network error: Connect timed out';
      } else {
        this.status = `Network error: ${msg}`;
      }
      this.emit('status_change', this.getStatus());
    });

    socket.on('close', () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      const wasDone = this.status === 'Done';
      if (wasDone) {
        // Se perdió la conexión que estaba activa: reintentar reconexión
        console.log(`[SeedLinkWorker:${this.server.name}] Conexión cerrada. Reconectando tras timeout...`);
        this.status = 'Connecting...';
        this.emit('status_change', this.getStatus());
        this.scheduleReconnect();
      } else {
        if (!this.status.includes('Network error')) {
          this.status = 'Network error: Connect timed out';
        }
        this.emit('status_change', this.getStatus());
        this.scheduleReconnect();
      }
    });
  }

  private handleHandshake(chunk: Buffer): void {
    if (!this.socket || this.socket.destroyed) return;
    this.handshakeBuffer += chunk.toString('ascii');
    const text = this.handshakeBuffer;

    if (this.handshakeState === 'HELLO') {
      if (text.includes('SeedLink')) {
        this.serverVersion = text.trim().split('\r\n')[0] || 'SeedLink v3';
        this.handshakeBuffer = '';
        this.prepareStationQueue();
        this.sendNextSubscription();
      }
      return;
    }

    if (this.handshakeState === 'AWAIT_STATION_OK') {
      if (text.includes('OK')) {
        this.handshakeBuffer = '';
        // Enviar SELECT para solicitar únicamente canales verticales (??Z) y evitar saturación por horizontales
        this.handshakeState = 'AWAIT_SELECT_OK';
        try {
          this.socket.write('SELECT ??Z\r\n');
        } catch (_) {}
      } else if (text.includes('ERROR')) {
        this.handshakeBuffer = '';
        // Si el comando STATION dio error, pasar directamente a DATA
        this.handshakeState = 'AWAIT_DATA_OK';
        try {
          this.socket.write('DATA\r\n');
        } catch (_) {}
      }
      return;
    }

    if (this.handshakeState === 'AWAIT_SELECT_OK') {
      if (!text.includes('OK') && !text.includes('ERROR')) return;
      this.handshakeBuffer = '';
      // Tras SELECT, enviar DATA
      this.handshakeState = 'AWAIT_DATA_OK';
      try {
        this.socket.write('DATA\r\n');
      } catch (_) {}
      return;
    }

    if (this.handshakeState === 'AWAIT_DATA_OK') {
      if (text.includes('OK') || text.includes('ERROR')) {
        const remaining = this.handshakeBuffer;
        this.handshakeBuffer = '';
        this.sendNextSubscription(Buffer.from(remaining, 'ascii'));
      }
      return;
    }
  }

  private prepareStationQueue(): void {
    if (this.server.stationCode) {
      // Estación individual (ej. RAA84, RBFF6, etc.)
      this.stationQueue = [
        { code: this.server.stationCode, net: this.server.networkCode || 'AM' },
      ];
    } else if (this.server.host === '132.247.71.12') {
      // Red Sismológica Nacional (SSN - UNAM) y estaciones disponibles en México:
      // Catálogo verificado con las 68 estaciones oficiales del SSN (red IG),
      // 3 estaciones de Baja California (red BC - CICESE / RESBC),
      // y estaciones globales en territorio mexicano (IU.TEIG, IU.SLBS, G.UNM, RB.BAHB).
      const SSN_MEXICO_STATIONS: { code: string; net: string }[] = [
        // 68 Estaciones oficiales del SSN (Red Sísmica Nacional IG)
        { code: 'AAIG', net: 'IG' }, { code: 'ACIG', net: 'IG' }, { code: 'ANIG', net: 'IG' }, { code: 'ARIG', net: 'IG' },
        { code: 'BCIG', net: 'IG' }, { code: 'CAIG', net: 'IG' }, { code: 'CCIG', net: 'IG' }, { code: 'CGIG', net: 'IG' },
        { code: 'CHIQ', net: 'IG' }, { code: 'CJIG', net: 'IG' }, { code: 'CMIG', net: 'IG' }, { code: 'CRIG', net: 'IG' },
        { code: 'CSIG', net: 'IG' }, { code: 'CUIG', net: 'IG' }, { code: 'DAIG', net: 'IG' }, { code: 'DHIG', net: 'IG' },
        { code: 'FTIG', net: 'IG' }, { code: 'GTIG', net: 'IG' },
        { code: 'HLIG', net: 'IG' }, { code: 'HPIG', net: 'IG' }, { code: 'HSIG', net: 'IG' },
        { code: 'HUIG', net: 'IG' }, { code: 'IGIG', net: 'IG' }, { code: 'LNIG', net: 'IG' }, { code: 'LPIG', net: 'IG' },
        { code: 'LVIG', net: 'IG' }, { code: 'MAIG', net: 'IG' }, { code: 'MBIG', net: 'IG' }, { code: 'MCIG', net: 'IG' },
        { code: 'MEIG', net: 'IG' }, { code: 'MGIG', net: 'IG' }, { code: 'MMIG', net: 'IG' }, { code: 'MNIG', net: 'IG' },
        { code: 'MOIG', net: 'IG' }, { code: 'MYIG', net: 'IG' }, { code: 'NZIG', net: 'IG' }, { code: 'OXIG', net: 'IG' },
        { code: 'PATR', net: 'IG' }, { code: 'PAVE', net: 'IG' }, { code: 'PCIG', net: 'IG' }, { code: 'PDIG', net: 'IG' },
        { code: 'PEIG', net: 'IG' }, { code: 'PLIG', net: 'IG' }, { code: 'PNIG', net: 'IG' }, { code: 'PPIG', net: 'IG' },
        { code: 'PZIG', net: 'IG' }, { code: 'RPIG', net: 'IG' }, { code: 'SCIG', net: 'IG' }, { code: 'SPIG', net: 'IG' },
        { code: 'SRIG', net: 'IG' }, { code: 'TAIG', net: 'IG' }, { code: 'TGIG', net: 'IG' }, { code: 'THIG', net: 'IG' },
        { code: 'TJIG', net: 'IG' }, { code: 'TLIG', net: 'IG' }, { code: 'TOIG', net: 'IG' }, { code: 'TPIG', net: 'IG' },
        { code: 'TSIG', net: 'IG' }, { code: 'TUIG', net: 'IG' }, { code: 'TXIG', net: 'IG' }, { code: 'UPIG', net: 'IG' },
        { code: 'YAIG', net: 'IG' }, { code: 'YOIG', net: 'IG' }, { code: 'ZAIG', net: 'IG' }, { code: 'ZIIG', net: 'IG' },
        // Red Sísmica del Noroeste de México (BC - CICESE / RESBC)
        { code: 'CPX', net: 'BC' },
        { code: 'SFX', net: 'BC' },
        { code: 'CBX', net: 'BC' },
        // Redes Globales en territorio de México (IU / G / RB)
        { code: 'TEIG', net: 'IU' },
        { code: 'SLBS', net: 'IU' },
        { code: 'UNM', net: 'G' },
        { code: 'BAHB', net: 'RB' }
      ];
      this.stationQueue = [...SSN_MEXICO_STATIONS];
    } else if (this.server.host === 'rtserve.earthscope.org') {
      // FDSN / EarthScope (host actual; rtserve.iris.washington.edu fue retirado): red MX verificada con INFO STATIONS
      this.stationQueue = [
        { code: 'CCIG', net: 'MX' }, { code: 'HPIG', net: 'MX' }, { code: 'HSIG', net: 'MX' },
        { code: 'MOIG', net: 'MX' }, { code: 'SRIG', net: 'MX' }, { code: 'TLIG', net: 'MX' },
        { code: 'ZAIG', net: 'MX' },
        { code: 'CBX', net: 'BC' }, { code: 'RHX', net: 'BC' }, { code: 'SV2X', net: 'BC' },
        { code: 'UNM', net: 'G' }, { code: 'TEIG', net: 'IU' },
      ];
    } else if (this.server.host === '165.98.224.38') {
      // INETER 4 (165.98.224.38): publica México (MX), Panamá (RP/PA), Nicaragua (NU),
      // El Salvador (SV) y Guatemala (GI). Redes verificadas con INFO STATIONS.
      this.stationQueue = [
        // México (MX) - estaciones IG del catálogo servidas aquí con red MX
        { code: 'TGIG', net: 'MX' }, { code: 'TUIG', net: 'MX' }, { code: 'SCIG', net: 'MX' },
        { code: 'CMIG', net: 'MX' }, { code: 'MYIG', net: 'MX' }, { code: 'PCIG', net: 'MX' },
        { code: 'THIG', net: 'MX' }, { code: 'HSIG', net: 'MX' }, { code: 'ZAIG', net: 'MX' },
        { code: 'MOIG', net: 'MX' }, { code: 'SRIG', net: 'MX' }, { code: 'TLIG', net: 'MX' },
        // Panamá (RP / PA)
        { code: 'UPA', net: 'RP' }, { code: 'PNME', net: 'RP' }, { code: 'UPD2', net: 'RP' },
        { code: 'GMAL', net: 'RP' }, { code: 'AZU', net: 'RP' }, { code: 'PTP', net: 'RP' },
        { code: 'BRU2', net: 'PA' }, { code: 'GREIS', net: 'PA' }, { code: 'CIMA1', net: 'PA' },
        { code: 'SHARK', net: 'PA' },
        // Nicaragua (NU)
        { code: 'ACON', net: 'NU' }, { code: 'BLUN', net: 'NU' }, { code: 'CRIN', net: 'NU' },
        { code: 'MGAN', net: 'NU' }, { code: 'APQN', net: 'NU' }, { code: 'BILN', net: 'NU' },
        { code: 'CARN', net: 'NU' }, { code: 'HERN', net: 'NU' }, { code: 'HUEN', net: 'NU' },
        { code: 'LIMN', net: 'NU' }, { code: 'MATN', net: 'NU' }, { code: 'RCFN', net: 'NU' },
        { code: 'RIBN', net: 'NU' }, { code: 'SAPN', net: 'NU' }, { code: 'SIUN', net: 'NU' },
        { code: 'SMRN', net: 'NU' }, { code: 'STCN', net: 'NU' }, { code: 'CNGN2', net: 'NU' },
        // El Salvador (SV)
        { code: 'CALU', net: 'SV' }, { code: 'CEDA', net: 'SV' }, { code: 'FAME', net: 'SV' },
        { code: 'JAYA', net: 'SV' }, { code: 'MTO3', net: 'SV' }, { code: 'VSM2', net: 'SV' },
        { code: 'SNET', net: 'SV' }, { code: 'SENPD', net: 'SV' },
        { code: 'PASA1', net: 'SV' }, { code: 'SANTO', net: 'SV' }, { code: 'ARCE', net: 'SV' },
        { code: 'FAGO', net: 'SV' }, { code: 'AERO', net: 'SV' }, { code: 'CNCH', net: 'SV' },
        { code: 'NUBE', net: 'SV' }, { code: 'PAVA', net: 'SV' }, { code: 'P5NO', net: 'SV' },
        { code: 'TECD', net: 'SV' }, { code: 'ACABA', net: 'SV' },
        // Guatemala (GI)
        { code: 'HUHU', net: 'GI' }, { code: 'SMCA', net: 'GI' }, { code: 'RECH', net: 'GI' },
        { code: 'IZPB', net: 'GI' }, { code: 'CQES', net: 'GI' }, { code: 'IZLV', net: 'GI' },
        { code: 'QUIS', net: 'GI' }, { code: 'RERE', net: 'GI' }, { code: 'RESA', net: 'GI' },
        { code: 'SMOC', net: 'GI' }, { code: 'GCG4', net: 'GI' }, { code: 'JAMO', net: 'GI' },
        { code: 'PEPO', net: 'GI' }, { code: 'BDG', net: 'GI' }, { code: 'IZRD', net: 'GI' },
        { code: 'JUAM', net: 'GI' }, { code: 'JUMO', net: 'GI' }, { code: 'ZAES', net: 'GI' }
      ];
    } else if (this.server.host === '165.98.224.36') {
      // Más Estaciones (Redes Regionales: Honduras HN y Centroamérica TC/IU/NU)
      this.stationQueue = [
        // Honduras (HN)
        { code: 'TEG2', net: 'HN' }, { code: 'ROAT', net: 'HN' }, { code: 'SPSH', net: 'HN' },
        { code: 'COMA', net: 'HN' }, { code: 'CHOL', net: 'HN' }, { code: 'LPAZ', net: 'HN' },
        { code: 'AMPH', net: 'HN' }, { code: 'CAJON', net: 'HN' }, { code: 'COPHN', net: 'HN' },
        { code: 'GUAH', net: 'HN' }, { code: 'TRUJ', net: 'HN' }, { code: 'DANL', net: 'HN' },
        // Regional Centroamérica
        { code: 'EGUA', net: 'TC' }, { code: 'ELI1', net: 'TC' }, { code: 'QUEP', net: 'TC' },
        { code: 'TCS1', net: 'TC' }, { code: 'UPAL', net: 'TC' }, { code: 'TEIG', net: 'IU' },
        { code: 'ESPN', net: 'NU' }
      ];
    } else if (this.server.host === '165.98.224.46') {
      // INETER 1 / Red Sismológica Regional (Centroamérica, Honduras y Guatemala)
      this.stationQueue = [
        { code: 'EGUA', net: 'TC' },
        { code: 'ELI1', net: 'TC' },
        { code: 'QUEP', net: 'TC' },
        { code: 'TEIG', net: 'IU' },
        { code: 'TEG2', net: 'HN' },
        { code: 'SPSH', net: 'HN' },
        { code: 'ROAT', net: 'HN' },
        { code: 'GCG4', net: 'GI' },
        { code: 'SMCA', net: 'GI' },
        { code: 'HUHU', net: 'GI' },
        { code: 'RERE', net: 'GI' }
      ];
    } else if (this.server.host === '165.98.224.52') {
      // INETER 3 / Red Sismológica Regional
      this.stationQueue = [
        { code: 'ESPN', net: 'NU' },
        { code: 'LPAZ', net: 'HN' },
        { code: 'CHOL', net: 'HN' },
        { code: 'AMPH', net: 'HN' },
        { code: 'CAJON', net: 'HN' },
        { code: 'VPS8', net: 'TC' },
        { code: 'ICC1', net: 'TC' },
        { code: 'HUHU', net: 'GI' },
        { code: 'JAMO', net: 'GI' },
        { code: 'IZPB', net: 'GI' },
        { code: 'PEPO', net: 'GI' }
      ];
    } else if (this.server.host === '165.98.224.59') {
      // INETER 2
      this.stationQueue = [
        { code: 'EGUA', net: 'TC' },
        { code: 'ELI1', net: 'TC' },
        { code: 'QUEP', net: 'TC' },
        { code: 'BDG', net: 'GI' },
        { code: 'COMA', net: 'HN' },
        { code: 'COPHN', net: 'HN' },
      ];
    } else {
      this.stationQueue = [];
    }

    // Filtrar explícitamente cualquier estación excluida (Isla Socorro H06E y SV.TECD)
    this.stationQueue = this.stationQueue.filter(
      (s) => !EXCLUDED_SEEDLINK_STATIONS.has(s.code) && !EXCLUDED_SEEDLINK_STATIONS.has(`${s.net}.${s.code}`)
    );
  }

  private sendNextSubscription(lastChunk?: Buffer): void {
    if (!this.socket || this.socket.destroyed) return;

    while (this.stationQueue.length > 0) {
      const candidate = this.stationQueue.shift()!;
      if (EXCLUDED_SEEDLINK_STATIONS.has(candidate.code) || EXCLUDED_SEEDLINK_STATIONS.has(`${candidate.net}.${candidate.code}`)) {
        continue;
      }
      this.currentStation = candidate;
      this.handshakeState = 'AWAIT_STATION_OK';
      try {
        this.socket.write(`STATION ${this.currentStation.code} ${this.currentStation.net}\r\n`);
      } catch (_) {}
      return;
    }

    // Se concluyó la suscripción a todas las estaciones: enviar END para iniciar streaming inmediato
    this.handshakeState = 'STREAMING';
    this.status = 'Done';
    this.socket.setTimeout(0);
    this.emit('status_change', this.getStatus());
    try {
      this.socket.write('END\r\n');
    } catch (_) {}

    // Si el último chunk ya contenía inicio de tramas SL, preservarlo
    if (lastChunk && lastChunk.includes(SL_MAGIC)) {
      const slIdx = lastChunk.indexOf(SL_MAGIC);
      this.rxBuffer = lastChunk.slice(slIdx);
      this.processPacketBuffer();
    }
  }

  private processPacketBuffer(): void {
    while (this.rxBuffer.length >= 8) {
      const idx = this.rxBuffer.indexOf(SL_MAGIC);
      if (idx === -1) {
        // No hay encabezado 'SL'. Descartar datos de texto preservando último byte si es 'S'
        if (this.rxBuffer.length > 0 && this.rxBuffer[this.rxBuffer.length - 1] === 0x53) {
          this.rxBuffer = this.rxBuffer.slice(-1);
        } else {
          this.rxBuffer = Buffer.alloc(0);
        }
        break;
      }

      if (idx > 0) {
        // Descartar cualquier respuesta de texto previa (como OK\r\n o banner)
        this.rxBuffer = this.rxBuffer.slice(idx);
      }

      // Una trama completa de SeedLink mide 520 bytes (8 bytes SLxxxxxx + 512 bytes MiniSEED)
      if (this.rxBuffer.length < 520) {
        break;
      }

      const seq = this.rxBuffer.slice(2, 8).toString('ascii').trim();
      const mseedBytes = this.rxBuffer.slice(8, 520);
      this.rxBuffer = this.rxBuffer.slice(520);

      const record = parseMiniSeedRecord(mseedBytes);
      if (record) {
        const chan = (record.channel || '').toUpperCase();
        // Filtrar canales no sísmicos de calibración/diagnóstico para no saturar el visor
        if (chan.startsWith('LOG') || chan.startsWith('HCA') || chan.startsWith('ACE') || chan.startsWith('VM')) {
          continue;
        }
        this.packetsReceived++;
        this.lastPacketTime = new Date().toISOString();
        this.emit('packet', { server: this.server, record, seq });
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    // Si ya está conectado y con socket activo, NUNCA reconectar
    if (this.status === 'Done' && this.socket && !this.socket.destroyed) {
      return;
    }
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Solo reconectar si la conexión realmente no está en 'Done'
      if (this.status !== 'Done' || !this.socket || this.socket.destroyed) {
        this.connect(false);
      }
    }, (this.server.timeoutSec || 20) * 1000);
  }

  public reconnect(force: boolean = false): void {
    // Si ya está conectado exitosamente y no se ha perdido la conexión, NO reconectar
    if (!force && this.status === 'Done' && this.socket && !this.socket.destroyed) {
      return;
    }
    this.connect(force);
  }

  private startBitrateMeter(): void {
    if (this.bitrateInterval) clearInterval(this.bitrateInterval);
    this.bytesInWindow = 0;
    this.bitrateInterval = setInterval(() => {
      this.bitrateKbps = Number(((this.bytesInWindow * 8) / 1000).toFixed(1));
      this.bytesInWindow = 0;
    }, 1500);
  }

  public getStatus(): SeedLinkServerStatus {
    return {
      id: this.server.id,
      name: this.server.name,
      host: '🔒 Servidor Privado',
      port: this.server.port,
      timeoutSec: this.server.timeoutSec || 20,
      status: this.status,
      packetsReceived: this.packetsReceived,
      bytesReceived: this.bytesReceived,
      bitrateKbps: this.bitrateKbps,
      lastPacketTime: this.lastPacketTime,
      serverVersion: this.serverVersion || 'SeedLink v3',
      isPrimary: this.server.isPrimary || false,
      priority: this.server.priority || 2,
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.bitrateInterval) clearInterval(this.bitrateInterval);
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (_) {}
      this.socket = null;
    }
  }
}

export class SeedLinkMultiPool extends EventEmitter {
  private workers: Map<string, SeedLinkWorker> = new Map();

  constructor() {
    super();
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (const s of SEEDLINK_SERVERS) {
      const worker = new SeedLinkWorker(s);
      worker.on('packet', (data: PacketEventPayload) => {
        this.emit('packet', data);
      });
      worker.on('status_change', (status: SeedLinkServerStatus) => {
        this.emit('server_status_change', status);
      });
      worker.on('server_connected', (data: any) => {
        this.emit('server_connected', data);
      });
      this.workers.set(s.id, worker);
    }
  }

  public startAll(): void {
    console.log(`[SeedLinkMultiPool] Conectando a ${this.workers.size} servidores SeedLink (Priorizando servidor troncal SSN Nunca Muere)...`);
    
    // 1. Iniciar inmediatamente el servidor prioritario SSN (retraso 0ms)
    const primaryWorker = this.workers.get('ssn');
    if (primaryWorker) {
      console.log('[SeedLinkMultiPool] Conexión inmediata PRIORITARIA a Servidor SSN UNAM (132.247.71.12:18000)...');
      primaryWorker.start();
    }

    // 2. Escalonar el resto de servidores regionales cada 120ms
    let delay = 100;
    for (const [id, worker] of this.workers.entries()) {
      if (id === 'ssn') continue;
      setTimeout(() => {
        worker.start();
      }, delay);
      delay += 120;
    }
  }

  public getAllStatuses(): SeedLinkServerStatus[] {
    const list: SeedLinkServerStatus[] = [];
    for (const w of this.workers.values()) {
      list.push(w.getStatus());
    }
    // Ordenar para que el servidor troncal primario aparezca siempre al inicio
    list.sort((a, b) => (a.priority || 2) - (b.priority || 2));
    return list;
  }

  public reconnectServer(serverId: string, force: boolean = false): void {
    const w = this.workers.get(serverId);
    if (w) {
      w.reconnect(force);
    }
  }

  public reconnectAll(force: boolean = false): void {
    // 1. Reconectar prioritariamente al servidor troncal SSN
    const primaryWorker = this.workers.get('ssn');
    if (primaryWorker) {
      primaryWorker.reconnect(force);
    }

    // 2. Reconectar escalonadamente el resto
    let delay = 80;
    for (const [id, w] of this.workers.entries()) {
      if (id === 'ssn') continue;
      setTimeout(() => {
        w.reconnect(force);
      }, delay);
      delay += 80;
    }
  }

  public destroy(): void {
    for (const w of this.workers.values()) {
      w.destroy();
    }
    this.workers.clear();
  }
}
