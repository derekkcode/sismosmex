/**
 * MOTOR SISMOLÓGICO DE DETECCIÓN, LOCALIZACIÓN Y MAGNITUD (ARQUITECTURA GLOBALQUAKE)
 *
 * 1. Eventos por estación (gq-analysis.ts): cada canal vertical se filtra (2 - 5 Hz) y un evento nace cuando el cociente
 *    corto/largo de la amplitud supera el umbral; la llegada P se busca hacia atrás hasta el último instante en calma.
 * 2. Grupos (gq-cluster.ts): los eventos de estaciones vecinas con llegadas P compatibles (d / 5 km/s + 2.5 s) forman un
 *    grupo, que crece por cadena y por coincidencia con el hipocentro.
 * 3. Hipocentro (gq-hypocenter.ts): búsqueda en espiral de Vogel sobre latitud, longitud y profundidad; se cuentan las
 *    llegadas P "correctas" (dentro de 1.8 s del origen mediano). Un sismo se declara si al menos 4 llegadas son correctas
 *    (>= 50 % de las usadas), la cobertura angular y la incertidumbre son aceptables y no faltan llegadas evidentes.
 * 4. Magnitud (magnitude.ts): ML de Hutton & Boore a partir de la amplitud Wood-Anderson sintética, mediana de las
 *    estaciones a menos de 320 km (calibrada contra sismos reales de Baja California y México).
 * 5. Confirmación: un sismo preliminar solo se confirma con evidencia explícita: red multiestación coherente
 *    (>= 6 llegadas correctas con calidad C o mejor, o >= 5 con ajuste muy bueno), onda S observada (el pico de la
 *    sacudida cae en la ventana de la S esperada y supera el ruido propio) en >= 2 sitios independientes, o
 *    corroboración del SSN/USGS. El paso del tiempo no confirma nada.
 * 6. Persistencia: guarda los sismos en MongoDB (colección sismosmex.earthquakes).
 */

import { USGSEarthquakeService } from './usgs-service.js';
import { EarthquakeHistoryStore } from './history-store.js';
import { NoiseCalibrator, NoiseClass } from './noise-calibrator.js';
import { SeismicDspEngine, DEFAULT_STA_LTA_CONFIG } from './seismic-dsp.js';
import { GqPipeline, PipelineChange } from './gq-pipeline.js';
import { GqQuake, GqStation, QuakeRemovalReason } from './gq-cluster.js';
import { GqStationEvent } from './gq-analysis.js';
import { greatCircleKm } from './gq-geo.js';
import { estimateMagnitude, independentSites, markSWaveArrivals, sWaveWindowMs, MagnitudeEstimate } from './magnitude.js';
import { resolveLocationName } from './location-names.js';
import { getSsnHistory } from './ssn-history.js';
import { ExternalHypocenter, isPickConsistent, matchDetectedEvent, pickResidualSec } from './ssn-confirmation.js';
import {
  ConfirmationBasis,
  DetectedEarthquake,
  SeismicCandidate,
  StationTriggerRecord,
  generateDisplayId,
} from './earthquake-types.js';

export {
  PROFESSIONAL_NETWORKS,
  isMexicanIGNetwork,
  isGuatemalaStation,
  isGuatemalaNetwork,
  isElSalvadorStation,
  isElSalvadorNetwork,
  isChiapasStation,
} from './seismic-dsp.js';
export { calculateTravelTime1D, EARTH_RADIUS_KM, MOHO_DEPTH_KM, VP_VS_RATIO } from './travel-time.js';
export { generateDisplayId };
export type { ConfirmationBasis, DetectedEarthquake, SeismicCandidate, StationTriggerRecord };

const EXCLUDED_STATION_CODES = new Set(['H06E', 'TECD', 'IG.H06E', 'SV.TECD', 'QUEP', 'UPAL', 'TC.QUEP', 'TC.UPAL']);

// Mínimo de sitios independientes con onda S (o de llegadas correctas) para promover un sismo a confirmado
const MIN_SWAVE_SITES = 2;
const MIN_NETWORK_CONFIRM_STATIONS = 6;
const MIN_STRONG_FIT_STATIONS = 5;
// Ventana de seguimiento de amplitudes de una estación tras su llegada P (captura la onda S y las superficiales)
const AMPLITUDE_WINDOW_MS = 90_000;
const PEAK_BUFFER_MS = 150_000;
// Ruido previo a la llegada P: se mide en la ventana [tP - 75 s, tP - 8 s] del búfer de picos de la estación
const NOISE_WINDOW_START_MS = 75_000;
const NOISE_WINDOW_END_MS = 8_000;
const MIN_NOISE_SAMPLES = 20;
// Tras este tiempo desde el origen la interfaz ya no trata el sismo como activo
const ACTIVE_EVENT_WINDOW_MS = 300_000;
const MAX_STORED_EVENTS = 100;
const SSN_POLL_MS = 60_000;
const SSN_MAX_AGE_MS = 2 * 3600_000;
// Cociente mínimo de un evento de estación para atribuirlo a un sismo del SSN
const SSN_MIN_RATIO = 16;
const SSN_MAX_STATION_DISTANCE_KM = 300;

interface StationMeta {
  network: string;
  site: string;
  stateName: string;
  lat: number;
  lon: number;
  elevationM: number;
  reqPga?: number;
  noiseClass?: NoiseClass;
  freqDominantHz?: number;
  highFreqRatio?: number;
  isPureFrequency?: boolean;
}

interface PeakSample {
  t: number;
  pga: number;
  amp: number;
  wa: number;
}

export class SeismicDetectorEngine {
  private static instance: SeismicDetectorEngine;
  private earthquakes: DetectedEarthquake[] = [];
  // Historial del monitor en MongoDB. Mientras no esté listo, la API sirve el historial del SSN.
  private historyStore = new EarthquakeHistoryStore();
  private historyReady = false;
  private historyLoading = false;
  private persistChain: Promise<void> = Promise.resolve();
  private persistRetryTimer: NodeJS.Timeout | null = null;
  // Borrados pendientes en MongoDB (cancelados, expirados o fusionados) y limpieza solicitada.
  // Guardar solo inserta o actualiza: lo que no esté aquí nunca se borra de la base.
  private pendingHistoryDeletes: Set<string> = new Set();
  private pendingHistoryClear = false;
  // Momento (ms) de la última limpieza: los sismos de USGS anteriores a él no vuelven al historial
  private clearedAtMs = 0;

  private readonly pipeline: GqPipeline;
  // Sismo del canal GlobalQuake -> id del sismo detectado
  private readonly quakeEventIds: Map<number, string> = new Map();
  // Disparo de estación (por evento de estación) con sus picos de amplitud
  private readonly records: Map<number, StationTriggerRecord> = new Map();
  private readonly stationMeta: Map<string, StationMeta> = new Map();
  private readonly peakBuffers: Map<string, PeakSample[]> = new Map();
  private readonly ssnHandled: Set<string> = new Set();
  private lastSsnPollMs = 0;
  private ssnPollInFlight = false;
  private readonly ssnPollingEnabled: boolean;

  private activePreliminaryIds: Set<string> = new Set();
  private onEventDetectedCallback: ((event: DetectedEarthquake) => void) | null = null;
  // Callback cuando un evento preliminar se retira por falta de evidencia
  private onEventCancelledCallback: ((event: DetectedEarthquake, reason: string) => void) | null = null;
  private onCandidateChangedCallback: ((candidate: SeismicCandidate | null) => void) | null = null;
  private currentCandidate: SeismicCandidate | null = null;

  // Calibrador de ruido por canal: recibe la retroalimentación de los sismos confirmados
  private readonly noise: NoiseCalibrator;
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor(background: boolean, noise?: NoiseCalibrator) {
    this.pipeline = new GqPipeline();
    this.noise = noise ?? NoiseCalibrator.getInstance();
    this.ssnPollingEnabled = background;
    if (!background) return;

    this.loadHistoryFromMongo();
    // Reintenta la conexión a MongoDB si no estaba disponible al arrancar
    setInterval(() => {
      if (!this.historyReady && !this.historyLoading) this.loadHistoryFromMongo();
    }, 60 * 1000);

    // Sincronizar sismos de países de América >= 5.5 desde USGS (inmediato y cada 4 minutos)
    setTimeout(() => this.syncUSGSEarthquakes(), 2500);
    setInterval(() => this.syncUSGSEarthquakes(), 4 * 60 * 1000);

    // Ciclo de detección: agrupamiento, localización y revisión de evidencias una vez por segundo
    setInterval(() => this.tick(Date.now()), 1000);
  }

  public static getInstance(): SeismicDetectorEngine {
    if (!SeismicDetectorEngine.instance) {
      SeismicDetectorEngine.instance = new SeismicDetectorEngine(true);
    }
    return SeismicDetectorEngine.instance;
  }

  /** Instancia aislada (sin MongoDB, USGS, SSN ni temporizadores): el ciclo se ejecuta llamando a `tick` */
  public static createDetached(noise: NoiseCalibrator = new NoiseCalibrator({ persist: false })): SeismicDetectorEngine {
    return new SeismicDetectorEngine(false, noise);
  }

  public async syncUSGSEarthquakes(): Promise<void> {
    // Sin historial cargado no se conoce el corte de la última limpieza; la sincronización se repite al terminar la carga
    if (!this.historyReady) return;
    try {
      const fetched = await USGSEarthquakeService.getInstance().fetchRecentAmericanEarthquakes(5.5);
      const usgsEvents = (fetched ?? []).filter((eq) => eq.timeEpoch > this.clearedAtMs);
      if (usgsEvents.length > 0) {
        this.earthquakes = this.dedupeHistory([...this.earthquakes, ...usgsEvents]);
        this.saveEarthquakesToDisk();
      }
    } catch (e) {
      console.warn('[Detector] Error sincronizando sismos USGS:', (e as Error).message);
    }
  }

  public setOnEventDetected(cb: (event: DetectedEarthquake) => void): void {
    this.onEventDetectedCallback = cb;
  }

  public setOnEventCancelled(cb: (event: DetectedEarthquake, reason: string) => void): void {
    this.onEventCancelledCallback = cb;
  }

  public setOnCandidateChanged(cb: (candidate: SeismicCandidate | null) => void): void {
    this.onCandidateChangedCallback = cb;
  }

  public getSeismicCandidate(): SeismicCandidate | null {
    return this.currentCandidate ? structuredClone(this.currentCandidate) : null;
  }

  /** Canal GlobalQuake (estaciones, eventos y grupos): solo lectura, para diagnóstico y pruebas */
  public getPipeline(): GqPipeline {
    return this.pipeline;
  }

  /** Agrupa las escrituras de disco por actualización de amplitud en una cada 2 s */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveEarthquakesToDisk();
    }, 2000);
  }

  // =========================================================================
  // ENTRADA DE DATOS
  // =========================================================================

  /**
   * Recibe cada paquete de MiniSEED ya procesado por el DSP. Los canales verticales con `samples` alimentan el análisis
   * de eventos por estación; todos los componentes aportan los picos de PGA, amplitud y Wood-Anderson.
   */
  public processStationTelemetry(params: {
    station: string;
    network: string;
    channel: string;
    lat: number;
    lon: number;
    alt?: number;
    site: string;
    stateName: string;
    pga: number;
    amp: number;
    sampleRate: number;
    packetStartTime: string;
    samples?: ArrayLike<number>;
    woodAndersonDispMm?: number;
    minPgaThreshold?: number; // Piso de PGA calibrado del canal (ruido real * margen)
    noiseClass?: NoiseClass;
    freqDominantHz?: number;
    highFreqRatio?: number;
    isPureFrequencySeismic?: boolean;
  }): void {
    const {
      station, network, channel, lat, lon, alt, site, stateName, pga, amp, sampleRate, packetStartTime, samples,
      woodAndersonDispMm = 0, minPgaThreshold, noiseClass, freqDominantHz, highFreqRatio, isPureFrequencySeismic,
    } = params;

    const cleanSt = (station || '').trim().toUpperCase();
    if (EXCLUDED_STATION_CODES.has(cleanSt)) return;

    const packetTimeMs = new Date(packetStartTime).getTime();
    if (
      !cleanSt ||
      !Number.isFinite(packetTimeMs) ||
      packetTimeMs <= 0 ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(pga) ||
      !Number.isFinite(amp) ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      return;
    }

    const elevationM = Number.isFinite(alt) ? Number(alt) : 0;
    this.stationMeta.set(cleanSt, {
      network, site, stateName, lat, lon, elevationM,
      reqPga: minPgaThreshold, noiseClass, freqDominantHz, highFreqRatio, isPureFrequency: isPureFrequencySeismic,
    });

    const isVertical = (channel || '').toUpperCase().endsWith('Z');
    if (isVertical && samples && samples.length > 0) {
      this.pipeline.ingest({ network, code: cleanSt, lat, lon, elevationM }, channel, samples, packetTimeMs, sampleRate);
    }

    // Los picos de cada paquete se conservan tal cual: la señal de un sismo débil y lejano queda por debajo del piso de
    // detección STA/LTA de la interfaz, pero sigue siendo una medida válida de amplitud para el sismo ya asociado
    const sample: PeakSample = {
      t: packetTimeMs,
      pga,
      amp,
      wa: woodAndersonDispMm,
    };
    let buffer = this.peakBuffers.get(cleanSt);
    if (!buffer) {
      buffer = [];
      this.peakBuffers.set(cleanSt, buffer);
    }
    buffer.push(sample);
    while (buffer.length > 0 && packetTimeMs - buffer[0].t > PEAK_BUFFER_MS) buffer.shift();

    this.applyPeaks(cleanSt, sample);
  }

  /** Suma el paquete a los picos de los disparos de la estación cuya ventana de seguimiento lo contiene */
  private applyPeaks(station: string, sample: PeakSample): void {
    for (const record of this.records.values()) {
      if (record.station !== station) continue;
      if (sample.t < record.tP - 3000 || sample.t > record.tP + AMPLITUDE_WINDOW_MS) continue;
      this.trackPhasePeaks(record, sample.pga, sample.t);
      record.lastUpdateWallTime = Date.now();
      const owner = record.eventId ? this.earthquakes.find((e) => e.id === record.eventId) : undefined;
      if (owner) {
        this.updateEventPeaks(owner, record, sample.pga, sample.amp, sample.wa);
      } else {
        if (sample.pga > record.maxPga) record.maxPga = sample.pga;
        if (sample.amp > record.maxAmp) record.maxAmp = sample.amp;
        if (sample.wa > (record.woodAndersonAmpMm || 0)) record.woodAndersonAmpMm = sample.wa;
      }
    }
  }

  /** Pico de PGA dentro de la ventana de la onda S esperada (evidencia observada, no predicha) */
  private trackPhasePeaks(tr: StationTriggerRecord, pga: number, packetStartMs: number): void {
    const window = sWaveWindowMs(tr);
    if (!window) return;
    // El paquete dura 1 s: se considera de la ventana si se traslapa con ella
    if (packetStartMs >= window.startMs - 1000 && packetStartMs <= window.endMs && pga > (tr.sWindowPga ?? 0)) {
      tr.sWindowPga = pga;
    }
  }

  /**
   * Retira los eventos abiertos del canal indicado cuando el flujo deja de ser fiable (recepción bloqueada, retransmisión
   * o silencio). Los disparos que ya pertenecen a un sismo declarado no se alteran.
   */
  public clearStationTrigger(station: string, network?: string, channel?: string): void {
    const cleanSt = (station || '').trim().toUpperCase();
    for (const gqStation of this.pipeline.stations) {
      if (gqStation.info.code.toUpperCase() !== cleanSt) continue;
      if (network !== undefined && gqStation.info.network.toUpperCase() !== network.toUpperCase()) continue;
      const analyses = channel !== undefined
        ? [gqStation.analysisForChannel(channel)]
        : [...gqStation.allAnalyses()];
      for (const analysis of analyses) {
        if (!analysis) continue;
        for (const event of analysis.events) {
          if (!event.hasEnded() && event.clusterId === null) event.endBadly();
        }
      }
    }
  }

  // =========================================================================
  // CICLO DE DETECCIÓN
  // =========================================================================

  /** Un ciclo: agrupa, localiza, declara o actualiza sismos, revisa evidencias y refresca el candidato */
  public tick(nowMs: number): void {
    const changes = this.pipeline.run(nowMs);
    this.syncRecords(nowMs);
    for (const change of changes) this.applyChange(change, nowMs);
    this.reviewPreliminaries(nowMs);
    this.updateCandidate(nowMs);
    this.pollSsn(nowMs);
  }

  /** Mantiene un disparo por evento de estación con llegada P fijada y retira los que ya no existen */
  private syncRecords(nowMs: number): void {
    const alive = new Set<number>();
    for (const station of this.pipeline.stations) {
      for (const event of station.events) {
        if (!event.valid || event.isSWave || event.pWaveMs <= 0) continue;
        alive.add(event.id);
        this.recordFor(station, event, nowMs);
      }
    }
    for (const [id] of this.records) {
      if (!alive.has(id)) this.records.delete(id);
    }
  }

  private recordFor(station: GqStation, event: GqStationEvent, nowMs: number): StationTriggerRecord {
    let record = this.records.get(event.id);
    if (record) {
      if (record.tP !== event.pWaveMs) {
        record.tP = event.pWaveMs;
        record.tP_iso = new Date(event.pWaveMs).toISOString();
      }
      if (event.maxRatio > record.staLtaRatio) record.staLtaRatio = event.maxRatio;
      return record;
    }

    const meta = this.stationMeta.get(station.info.code.toUpperCase());
    record = {
      station: station.info.code.toUpperCase(),
      network: station.info.network,
      channel: station.detectionChannel ?? '',
      lat: station.lat,
      lon: station.lon,
      elevationM: station.elevationM,
      site: meta?.site ?? station.info.code,
      stateName: meta?.stateName ?? '',
      tP: event.pWaveMs,
      tP_iso: new Date(event.pWaveMs).toISOString(),
      receivedWallTime: nowMs,
      lastUpdateWallTime: nowMs,
      staLtaRatio: event.maxRatio,
      maxPga: 0,
      maxAmp: 0,
      woodAndersonAmpMm: 0,
      isPureFrequency: meta?.isPureFrequency,
      freqDominantHz: meta?.freqDominantHz,
      highFreqRatio: meta?.highFreqRatio,
      reqRatio: this.pipeline.params.analysis.eventThreshold ?? 4.75,
      reqPga: meta?.reqPga ?? DEFAULT_STA_LTA_CONFIG.minPgaStandard,
      noiseClass: meta?.noiseClass,
      gqEventId: event.id,
    };
    record.noisePga = this.measureNoisePga(record);
    // Los paquetes previos a la creación del disparo (la llegada P se fija con retraso) aportan sus picos
    for (const sample of this.peakBuffers.get(record.station) ?? []) {
      if (sample.t < record.tP - 3000 || sample.t > record.tP + AMPLITUDE_WINDOW_MS) continue;
      this.trackPhasePeaks(record, sample.pga, sample.t);
      if (sample.pga > record.maxPga) record.maxPga = sample.pga;
      if (sample.amp > record.maxAmp) record.maxAmp = sample.amp;
      if (sample.wa > (record.woodAndersonAmpMm || 0)) record.woodAndersonAmpMm = sample.wa;
    }
    this.records.set(event.id, record);
    return record;
  }

  /** Pico de PGA del ruido de la estación antes de la llegada P; undefined si el búfer aún no cubre esa ventana */
  private measureNoisePga(record: StationTriggerRecord): number | undefined {
    let peak = 0;
    let count = 0;
    for (const sample of this.peakBuffers.get(record.station) ?? []) {
      if (sample.t < record.tP - NOISE_WINDOW_START_MS || sample.t > record.tP - NOISE_WINDOW_END_MS) continue;
      count++;
      if (sample.pga > peak) peak = sample.pga;
    }
    return count >= MIN_NOISE_SAMPLES ? peak : undefined;
  }

  private applyChange(change: PipelineChange, nowMs: number): void {
    if (change.type === 'created') {
      this.declareFromQuake(change.quake, nowMs);
    } else if (change.type === 'updated') {
      this.updateFromQuake(change.quake, change.magnitudeOnly, nowMs);
    } else {
      this.retireQuakeEvent(change.quake, change.reason);
    }
  }

  private findEventById(id: string | undefined): DetectedEarthquake | undefined {
    return id ? this.earthquakes.find((e) => e.id === id) : undefined;
  }

  private eventOfQuake(quake: GqQuake): DetectedEarthquake | undefined {
    const byId = this.findEventById(this.quakeEventIds.get(quake.id));
    if (byId) return byId;
    // La fusión de duplicados del historial puede haber cambiado el id: se reconoce el mismo sismo por origen y lugar
    const h = quake.hypocenter;
    const near = this.earthquakes.find(
      (e) => Math.abs((e.timeEpoch || 0) - h.originMs) < 30_000 && this.haversineDistanceKm(e.latitude, e.longitude, h.lat, h.lon) < 150
    );
    if (near) this.quakeEventIds.set(quake.id, near.id);
    return near;
  }

  /** Registros de las llegadas del grupo que el hipocentro explica (las demás no son del sismo) */
  private correctRecords(quake: GqQuake, nowMs: number): StationTriggerRecord[] {
    const h = quake.hypocenter;
    const result: StationTriggerRecord[] = [];
    for (const [station, event] of quake.cluster.validEvents()) {
      if (!h.correctKeys.includes(station.key)) continue;
      const record = this.recordFor(station, event, nowMs);
      record.residualSec = h.residualsSec[station.key];
      result.push(record);
    }
    return result;
  }

  private magnitudeFor(quake: GqQuake, records: StationTriggerRecord[], nowMs: number): MagnitudeEstimate {
    const h = quake.hypocenter;
    const estimate = this.estimateMagnitude(records, h.lat, h.lon, h.depthKm, nowMs);
    // La hora esperada de la onda S ya es conocida: se recalcula el pico dentro de su ventana y se recuenta
    this.refreshSWaveEvidence(records);
    const sWaveSites = markSWaveArrivals(records, h.lat, h.lon, h.depthKm, nowMs);
    estimate.sWaveArrivedCount = sWaveSites;
    estimate.isSWaveConfirmed = sWaveSites >= MIN_SWAVE_SITES;
    // Sin PGA utilizable (p. ej. canales recién iniciados) se usa la magnitud interna por cocientes antes que perder el sismo
    if (estimate.validStationCount === 0 || estimate.magnitude <= 0) {
      return { ...estimate, magnitude: Number(Math.max(0, quake.gqMagnitude).toFixed(1)) };
    }
    return estimate;
  }

  /**
   * La ventana de la onda S solo se conoce al localizar el sismo (y cambia si el hipocentro se mueve): el pico dentro de
   * ella se recalcula con los paquetes ya recibidos y el ruido previo se mide en cuanto el búfer lo cubre.
   */
  private refreshSWaveEvidence(records: StationTriggerRecord[]): void {
    for (const record of records) {
      const buffer = this.peakBuffers.get(record.station);
      if (!buffer || buffer.length === 0) continue;
      if (record.noisePga === undefined) record.noisePga = this.measureNoisePga(record);
      const window = sWaveWindowMs(record);
      if (!window) continue;
      let peak = 0;
      for (const sample of buffer) {
        if (sample.t >= window.startMs - 1000 && sample.t <= window.endMs && sample.pga > peak) peak = sample.pga;
      }
      // El búfer solo conserva 150 s: si ya no cubre la ventana se conserva el pico acumulado
      const covered = buffer[0].t <= window.startMs - 1000;
      record.sWindowPga = covered ? peak : Math.max(peak, record.sWindowPga ?? 0);
    }
  }

  /**
   * Evidencia que confirma un sismo localizado, o null si todavía es preliminar:
   *  - onda S observada en >= 2 sitios independientes;
   *  - red coherente: >= 6 llegadas correctas con calidad C o mejor, o >= 5 con residuo RMS <= 0.8 s,
   *    >= 80 % de llegadas correctas e incertidumbre <= 50 km.
   */
  private confirmationBasis(quake: GqQuake, sWaveConfirmed: boolean): ConfirmationBasis | null {
    if (sWaveConfirmed) return 'S_WAVE';
    const h = quake.hypocenter;
    const correctness = h.correctEvents / Math.max(1, h.usedEvents);
    if (h.correctEvents >= MIN_NETWORK_CONFIRM_STATIONS && 'SABC'.includes(h.quality)) return 'NETWORK';
    if (
      h.correctEvents >= MIN_STRONG_FIT_STATIONS &&
      correctness >= 0.8 &&
      h.rmsSec <= 0.8 &&
      h.locationUncertaintyKm <= 50
    ) {
      return 'NETWORK';
    }
    return null;
  }

  private clusterLevelFor(quake: GqQuake, confirmed: boolean): number {
    if (confirmed) return 3;
    return quake.cluster.level >= 1 || quake.hypocenter.correctEvents >= 5 ? 2 : 1;
  }

  private describeSource(event: DetectedEarthquake, quake: GqQuake): string {
    const h = quake.hypocenter;
    const stations = event.stationCount;
    if (event.status === 'CONFIRMED') {
      const basis = event.confirmationBasis === 'S_WAVE' ? 'por onda S' : 'por red';
      return `Confirmado ${basis} (Nivel ${event.clusterLevel}, ${stations} estaciones, calidad ${h.quality})`;
    }
    return `Sismo preliminar de red (Nivel ${event.clusterLevel}, ${stations} estaciones, calidad ${h.quality})`;
  }

  private declareFromQuake(quake: GqQuake, nowMs: number): void {
    const h = quake.hypocenter;
    const records = this.correctRecords(quake, nowMs);
    if (records.length === 0) return;
    const mag = this.magnitudeFor(quake, records, nowMs);
    const siteCount = independentSites(records).length;
    const basis = this.confirmationBasis(quake, mag.isSWaveConfirmed);
    const nowIso = new Date(nowMs).toISOString();
    const id = `eq-${nowIso.replace(/[-:T.Z]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
    const confirmed = basis !== null;
    const maxPga = Number(Math.max(0.05, mag.maxPga).toFixed(2));

    const event: DetectedEarthquake = {
      id,
      displayId: generateDisplayId(id),
      time: new Date(h.originMs).toISOString(),
      timeEpoch: Math.round(h.originMs),
      detectedAt: nowIso,
      latitude: Number(h.lat.toFixed(3)),
      longitude: Number(h.lon.toFixed(3)),
      depth: Math.round(h.depthKm),
      magnitude: mag.magnitude,
      magnitudeType: confirmed ? 'ML' : 'ML (Preliminar)',
      location: resolveLocationName(h.lat, h.lon),
      maxPga,
      maxIntensity: Math.max(1, mag.maxIntensity || 1),
      stationCount: siteCount,
      stations: records,
      status: confirmed ? 'CONFIRMED' : 'PRELIMINARY',
      source: '',
      azimuthalGap: h.azimuthalGapDeg,
      rmsResidualSec: Number(h.rmsSec.toFixed(2)),
      clusterLevel: this.clusterLevelFor(quake, confirmed),
      sWaveArrivedCount: mag.sWaveArrivedCount,
      isSWaveConfirmed: mag.isSWaveConfirmed,
      quality: h.quality,
      locationUncertaintyKm: Math.round(h.locationUncertaintyKm),
      depthFixed: h.depthFixed,
      reportNumber: 1,
    };
    if (basis) {
      event.confirmationBasis = basis;
      event.isLocked = true;
    }
    event.source = this.describeSource(event, quake);

    this.quakeEventIds.set(quake.id, id);
    if (!confirmed) this.activePreliminaryIds.add(id);
    this.earthquakes.unshift(event);
    if (this.earthquakes.length > MAX_STORED_EVENTS) this.earthquakes.pop();
    this.markEventStations(event, nowMs);
    this.saveEarthquakesToDisk();
    console.log(`[Detector] ${confirmed ? '✅ SISMO CONFIRMADO' : '⚠️ SISMO PRELIMINAR'} ${id}: ${event.location}, M ${event.magnitude}, prof ${event.depth} km, ${siteCount} estaciones (correctas ${h.correctEvents}/${h.usedEvents}), calidad ${h.quality}, RMS ${event.rmsResidualSec}s, incertidumbre ${event.locationUncertaintyKm} km.`);
    this.onEventDetectedCallback?.(event);
  }

  private updateFromQuake(quake: GqQuake, magnitudeOnly: boolean, nowMs: number): void {
    const event = this.eventOfQuake(quake);
    if (!event) {
      // El evento pudo fusionarse con otro del historial: si no existe en absoluto se declara de nuevo
      this.declareFromQuake(quake, nowMs);
      return;
    }
    const h = quake.hypocenter;
    const records = this.correctRecords(quake, nowMs);
    if (records.length === 0) return;
    const mag = this.magnitudeFor(quake, records, nowMs);
    const wasConfirmed = event.status === 'CONFIRMED';
    const external = event.confirmationBasis === 'SSN' || event.confirmationBasis === 'USGS';

    if (!magnitudeOnly && !external) {
      event.latitude = Number(h.lat.toFixed(3));
      event.longitude = Number(h.lon.toFixed(3));
      event.depth = Math.round(h.depthKm);
      event.time = new Date(h.originMs).toISOString();
      event.timeEpoch = Math.round(h.originMs);
      event.location = resolveLocationName(h.lat, h.lon);
      event.azimuthalGap = h.azimuthalGapDeg;
      event.rmsResidualSec = Number(h.rmsSec.toFixed(2));
      event.quality = h.quality;
      event.locationUncertaintyKm = Math.round(h.locationUncertaintyKm);
      event.depthFixed = h.depthFixed;
      event.stations = records;
      event.stationCount = independentSites(records).length;
      event.reportNumber = (event.reportNumber || 1) + 1;
    }
    if (!external && mag.magnitude > 0) {
      event.magnitude = wasConfirmed ? Math.max(event.magnitude, mag.magnitude) : mag.magnitude;
    }
    event.maxPga = Number(Math.max(event.maxPga, mag.maxPga).toFixed(2));
    event.maxIntensity = Math.max(event.maxIntensity, mag.maxIntensity);
    event.sWaveArrivedCount = mag.sWaveArrivedCount;
    event.isSWaveConfirmed = mag.isSWaveConfirmed;

    if (!wasConfirmed) {
      const basis = this.confirmationBasis(quake, mag.isSWaveConfirmed);
      if (basis) this.confirmEvent(event, basis, quake);
    }
    if (!external) event.source = this.describeSource(event, quake);
    event.clusterLevel = this.clusterLevelFor(quake, event.status === 'CONFIRMED');
    event.saved = true;
    this.markEventStations(event, nowMs);
    this.saveEarthquakesToDisk();
    this.onEventDetectedCallback?.(event);
  }

  private confirmEvent(event: DetectedEarthquake, basis: ConfirmationBasis, quake?: GqQuake): void {
    event.status = 'CONFIRMED';
    event.confirmationBasis = basis;
    event.magnitudeType = 'ML';
    event.isLocked = true;
    this.activePreliminaryIds.delete(event.id);
    if (quake) event.source = this.describeSource(event, quake);
    console.log(`[Detector] ✅ EVENTO CONFIRMADO (${basis}): ${event.id}, ${event.location}, M ${event.magnitude}, ${event.stationCount} estaciones.`);
  }

  /** Un grupo que se disolvió: si el sismo no estaba confirmado se retira; los confirmados permanecen en el historial */
  private retireQuakeEvent(quake: GqQuake, reason: QuakeRemovalReason | 'rejected'): void {
    const eventId = this.quakeEventIds.get(quake.id);
    this.quakeEventIds.delete(quake.id);
    const event = this.findEventById(eventId);
    if (!event) return;
    this.activePreliminaryIds.delete(event.id);
    if (event.status === 'CONFIRMED' || event.isLocked) return;

    this.earthquakes = this.earthquakes.filter((e) => e.id !== event.id);
    this.pendingHistoryDeletes.add(event.id);
    for (const st of event.stations || []) {
      st.rejected = true;
      st.eventId = undefined;
    }
    if (reason === 'merged') {
      this.saveEarthquakesToDisk();
      return;
    }
    console.log(`[Detector] Evento preliminar ${event.id} retirado (${reason}): ${event.stationCount} estaciones, M ${event.magnitude}.`);
    this.saveEarthquakesToDisk();
    // Un sismo que la interfaz ya no muestra como activo se retira del historial sin sonido de desconfirmación
    if (Date.now() - event.timeEpoch < ACTIVE_EVENT_WINDOW_MS) {
      this.onEventCancelledCallback?.(event, reason === 'rejected' ? 'cancelled' : 'unconfirmed_expired');
    }
  }

  /** Asocia los disparos al evento y, si está confirmado, premia a sus canales en el calibrador de ruido */
  private markEventStations(event: DetectedEarthquake, nowMs: number): void {
    const confirmed = event.status === 'CONFIRMED';
    for (const st of event.stations) {
      st.eventId = event.id;
      if (confirmed && !st.corroborated) {
        st.corroborated = true;
        this.noise.reportCorroboratedTrigger(NoiseCalibrator.streamKey(st.network, st.station, st.channel), nowMs);
      }
    }
  }

  // =========================================================================
  // EVIDENCIA FÍSICA: ONDA S
  // =========================================================================

  /**
   * Preliminares vivos dentro de su ventana: la llegada de la onda S depende del tiempo y no de nuevos paquetes de P,
   * así que se revisa en cada ciclo. Nada se confirma por el simple paso del tiempo.
   */
  private reviewPreliminaries(nowMs: number): void {
    for (const event of this.earthquakes) {
      if (event.status !== 'PRELIMINARY' || event.isLocked) continue;
      if (nowMs - event.timeEpoch > ACTIVE_EVENT_WINDOW_MS) continue;
      this.confirmPreliminaryIfEvidence(event, nowMs);
    }
  }

  /** Promueve el preliminar a confirmado si hay onda S en >= 2 sitios independientes y >= 4 sitios en total */
  private confirmPreliminaryIfEvidence(event: DetectedEarthquake, nowMs: number): void {
    if (event.status !== 'PRELIMINARY' || event.isLocked) return;
    markSWaveArrivals(event.stations, event.latitude, event.longitude, event.depth, nowMs);
    this.refreshSWaveEvidence(event.stations);
    const sWaveSiteCount = markSWaveArrivals(event.stations, event.latitude, event.longitude, event.depth, nowMs);
    const sites = independentSites(event.stations).length;
    event.sWaveArrivedCount = sWaveSiteCount;
    event.isSWaveConfirmed = sWaveSiteCount >= MIN_SWAVE_SITES;
    if (sites < 4 || sWaveSiteCount < MIN_SWAVE_SITES) return;
    this.confirmEvent(event, 'S_WAVE');
    event.stationCount = sites;
    event.clusterLevel = 3;
    event.source = `Confirmado por onda S (Nivel 3, ${sites} estaciones, onda S en ${sWaveSiteCount})`;
    this.markEventStations(event, nowMs);
    this.saveEarthquakesToDisk();
    this.onEventDetectedCallback?.(event);
  }

  /** Acumula los picos de PGA y amplitud en la estación y en el evento; si la magnitud re-estimada sube, la actualiza. */
  private updateEventPeaks(
    event: DetectedEarthquake,
    st: StationTriggerRecord,
    pga: number,
    amp: number,
    woodAndersonAmpMm: number
  ): void {
    let changed = false;

    if (pga > st.maxPga) {
      st.maxPga = pga;
      changed = true;
    }
    if (amp > st.maxAmp) {
      st.maxAmp = amp;
      changed = true;
    }
    if (woodAndersonAmpMm > (st.woodAndersonAmpMm || 0)) {
      st.woodAndersonAmpMm = woodAndersonAmpMm;
      changed = true;
    }

    if (pga > event.maxPga) {
      event.maxPga = pga;
      event.maxIntensity = SeismicDspEngine.pgaToMercalli(pga);
      changed = true;
    }

    if (!changed) return;

    // Re-estimar la magnitud con el pico real de la onda S
    const updatedMag = this.estimateMagnitude(event.stations, event.latitude, event.longitude, event.depth);
    if (updatedMag.validStationCount > 0 && updatedMag.magnitude > event.magnitude) {
      console.log(`[Detector:S-Wave] Actualización de pico de onda S para evento ${event.id}: M ${event.magnitude} -> ${updatedMag.magnitude}, PGA ${event.maxPga} -> ${updatedMag.maxPga} gal`);
      event.magnitude = updatedMag.magnitude;
      event.maxIntensity = updatedMag.maxIntensity;
    }
    this.scheduleSave();
    this.onEventDetectedCallback?.(event);
  }

  public estimateMagnitude(
    stations: StationTriggerRecord[],
    epiLat: number,
    epiLon: number,
    depthKm: number = 15.0,
    nowMs: number = Date.now()
  ): MagnitudeEstimate {
    return estimateMagnitude(stations, epiLat, epiLon, depthKm, nowMs);
  }

  // =========================================================================
  // CANDIDATOS: GRUPOS COHERENTES QUE AÚN NO SE PUEDEN LOCALIZAR
  // =========================================================================

  private updateCandidate(nowMs: number): void {
    const found = this.pipeline.candidates(3, nowMs);
    let best = found[0];
    for (const candidate of found) if (candidate.stations.length > (best?.stations.length ?? 0)) best = candidate;

    const candidate: SeismicCandidate | null = best
      ? {
          stationCount: best.stations.length,
          stations: best.stations.map((s) => `${s.info.network}.${s.info.code}`).sort(),
          firstTriggerTime: new Date(best.firstPickMs).toISOString(),
        }
      : null;
    if (JSON.stringify(this.currentCandidate ?? null) === JSON.stringify(candidate)) return;
    this.currentCandidate = candidate;
    this.onCandidateChangedCallback?.(this.getSeismicCandidate());
  }

  // =========================================================================
  // CORROBORACIÓN CON EL SSN
  // =========================================================================

  private pollSsn(nowMs: number): void {
    if (!this.ssnPollingEnabled || this.ssnPollInFlight || nowMs - this.lastSsnPollMs < SSN_POLL_MS) return;
    this.lastSsnPollMs = nowMs;
    this.ssnPollInFlight = true;
    getSsnHistory(SSN_POLL_MS / 2)
      .then((events) => this.reconcileWithSsn(events, Date.now()))
      .catch((err) => console.warn('[Detector:SSN] No se pudo conciliar con el SSN:', (err as Error).message))
      .finally(() => {
        this.ssnPollInFlight = false;
      });
  }

  /**
   * Compara cada sismo reciente del SSN con lo que la red detectó:
   *  1. si coincide con un sismo preliminar propio, lo confirma (ubicación y magnitud oficiales);
   *  2. si no hay sismo propio pero una o más estaciones registraron una llegada P compatible con el hipocentro del SSN,
   *     se registra como detectado en esas estaciones y confirmado por el SSN;
   *  3. si ninguna estación lo vio, se deja constancia en el registro para evaluar la cobertura.
   */
  public reconcileWithSsn(ssnEvents: DetectedEarthquake[], nowMs: number): void {
    for (const ssn of ssnEvents) {
      if (this.ssnHandled.has(ssn.id)) continue;
      if (nowMs - ssn.timeEpoch > SSN_MAX_AGE_MS || nowMs - ssn.timeEpoch < 0) continue;
      const external: ExternalHypocenter = {
        timeEpoch: ssn.timeEpoch,
        latitude: ssn.latitude,
        longitude: ssn.longitude,
        depth: ssn.depth,
      };

      const own = this.earthquakes.find((e) => {
        if (e.confirmationBasis === 'SSN' || e.category === 'ssn' || e.isInter) return false;
        const picks = (e.stations || []).map((s) => ({ tP: s.tP, lat: s.lat, lon: s.lon, elevationM: s.elevationM }));
        return matchDetectedEvent(external, e, picks) !== null;
      });
      if (own) {
        this.ssnHandled.add(ssn.id);
        this.applySsnToEvent(own, ssn, nowMs);
        continue;
      }

      // Se espera a que pasen los minutos de la propagación y del análisis de las estaciones antes de decidir
      if (nowMs - ssn.timeEpoch < 90_000) continue;
      this.ssnHandled.add(ssn.id);
      const matched = this.stationsMatchingSsn(external, nowMs);
      if (matched.length > 0) {
        this.declareFromSsn(ssn, matched, nowMs);
      } else if (ssn.magnitude >= 3.0) {
        this.logMissedSsnEvent(ssn);
      }
    }
  }

  private stationsMatchingSsn(external: ExternalHypocenter, nowMs: number): StationTriggerRecord[] {
    const matched: StationTriggerRecord[] = [];
    for (const station of this.pipeline.stations) {
      if (greatCircleKm(external.latitude, external.longitude, station.lat, station.lon) > SSN_MAX_STATION_DISTANCE_KM) continue;
      for (const event of station.events) {
        if (!event.valid || event.pWaveMs <= 0 || event.maxRatio < SSN_MIN_RATIO) continue;
        const record = this.recordFor(station, event, nowMs);
        if (!isPickConsistent(external, record)) continue;
        record.residualSec = Number(pickResidualSec(external, record).toFixed(2));
        matched.push(record);
        break;
      }
    }
    return matched;
  }

  private applySsnToEvent(event: DetectedEarthquake, ssn: DetectedEarthquake, nowMs: number): void {
    event.latitude = ssn.latitude;
    event.longitude = ssn.longitude;
    event.depth = ssn.depth;
    event.time = ssn.time;
    event.timeEpoch = ssn.timeEpoch;
    this.setStationDistances(event.stations, ssn.latitude, ssn.longitude);
    event.location = ssn.location || resolveLocationName(ssn.latitude, ssn.longitude);
    event.magnitude = ssn.magnitude;
    event.magnitudeType = 'M (SSN)';
    event.status = 'CONFIRMED';
    event.confirmationBasis = 'SSN';
    event.source = `Detectado por la red y confirmado por el SSN (${event.stationCount} estaciones)`;
    event.clusterLevel = 3;
    event.saved = true;
    event.isLocked = true;
    this.activePreliminaryIds.delete(event.id);
    this.markEventStations(event, nowMs);
    this.saveEarthquakesToDisk();
    console.log(`[Detector:SSN] ✅ ${event.id} confirmado por el SSN: M ${ssn.magnitude}, ${ssn.location}.`);
    this.onEventDetectedCallback?.(event);
  }

  private setStationDistances(records: StationTriggerRecord[], lat: number, lon: number): void {
    for (const record of records) record.distanceKm = Number(greatCircleKm(lat, lon, record.lat, record.lon).toFixed(1));
  }

  private declareFromSsn(ssn: DetectedEarthquake, records: StationTriggerRecord[], nowMs: number): void {
    this.setStationDistances(records, ssn.latitude, ssn.longitude);
    const nowIso = new Date(nowMs).toISOString();
    const id = `eq-${nowIso.replace(/[-:T.Z]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
    const codes = records.map((r) => `${r.network}.${r.station}`).sort();
    const maxPga = Number(records.reduce((max, r) => Math.max(max, r.maxPga), 0).toFixed(2));
    const event: DetectedEarthquake = {
      id,
      displayId: generateDisplayId(id),
      time: ssn.time,
      timeEpoch: ssn.timeEpoch,
      detectedAt: nowIso,
      latitude: ssn.latitude,
      longitude: ssn.longitude,
      depth: ssn.depth,
      magnitude: ssn.magnitude,
      magnitudeType: 'M (SSN)',
      location: ssn.location,
      maxPga,
      maxIntensity: maxPga > 0 ? Math.max(1, SeismicDspEngine.pgaToMercalli(maxPga)) : 1,
      intensityKnown: maxPga > 0,
      stationCount: records.length,
      stations: records,
      status: 'CONFIRMED',
      source: `Detectado en ${codes.join(', ')} y confirmado por el SSN`,
      clusterLevel: 3,
      confirmationBasis: 'SSN',
      saved: true,
      reportNumber: 1,
      isLocked: true,
    };
    this.earthquakes.unshift(event);
    if (this.earthquakes.length > MAX_STORED_EVENTS) this.earthquakes.pop();
    this.markEventStations(event, nowMs);
    this.saveEarthquakesToDisk();
    console.log(`[Detector:SSN] ✅ Sismo del SSN M ${ssn.magnitude} (${ssn.location}) detectado en ${codes.join(', ')}.`);
    this.onEventDetectedCallback?.(event);
  }

  /** Constancia, para evaluar la cobertura, de un sismo del SSN que ninguna estación registró con claridad */
  private logMissedSsnEvent(ssn: DetectedEarthquake): void {
    let nearest: { station: GqStation; distKm: number } | null = null;
    for (const station of this.pipeline.stations) {
      const distKm = greatCircleKm(ssn.latitude, ssn.longitude, station.lat, station.lon);
      if (!nearest || distKm < nearest.distKm) nearest = { station, distKm };
    }
    if (!nearest) return;
    const events = nearest.station.events.filter((e) => e.valid && e.pWaveMs > 0).length;
    console.log(`[Detector:SSN] Sismo del SSN M ${ssn.magnitude} (${ssn.location}) sin detección propia: estación más cercana ${nearest.station.key} a ${nearest.distKm.toFixed(0)} km, ${events} evento(s) válidos en ella.`);
  }

  // =========================================================================
  // HISTORIAL, PERSISTENCIA Y DUPLICADOS
  // =========================================================================

  /**
   * Elimina sismos duplicados por id, displayId o cercanía temporal y espacial.
   */
  public deduplicateEarthquakes(list: DetectedEarthquake[]): DetectedEarthquake[] {
    // Los registros antiguos pueden no traer isLocked: un CONFIRMED también cuenta como bloqueado
    const lockedOf = (e: DetectedEarthquake) => e.isLocked === true || e.status === 'CONFIRMED';
    // Une estaciones por identidad de objeto: ningún registro se pierde y el mismo registro no se repite
    const unionStations = (base: StationTriggerRecord[] | undefined, extra: StationTriggerRecord[] | undefined): StationTriggerRecord[] => {
      const kept = base || [];
      return [...kept, ...(extra || []).filter((s) => !kept.includes(s))];
    };
    const result: DetectedEarthquake[] = [];
    for (const eq of list) {
      if (!eq) continue;
      const matchIdx = result.findIndex(r => {
        if (r.id === eq.id || (r.displayId && eq.displayId && r.displayId === eq.displayId)) return true;
        const timeDiff = Math.abs((r.timeEpoch || 0) - (eq.timeEpoch || 0));
        const dist = this.haversineDistanceKm(r.latitude, r.longitude, eq.latitude, eq.longitude);
        if (timeDiff < 30000 && dist < 150.0) return true;

        if (timeDiff < 150000 && dist < 420.0 && Array.isArray(r.stations) && Array.isArray(eq.stations)) {
          const rCodes = new Set(r.stations.map((s: any) => `${(s.network || '').toUpperCase()}.${(s.station || s.code || '').toUpperCase()}`));
          const sharedCount = eq.stations.filter((s: any) => rCodes.has(`${(s.network || '').toUpperCase()}.${(s.station || s.code || '').toUpperCase()}`)).length;
          if (sharedCount >= 2) return true;
        }
        return false;
      });

      if (matchIdx >= 0) {
        const existing = result[matchIdx];
        const existingLocked = lockedOf(existing);
        const eqLocked = lockedOf(eq);
        if (existingLocked !== eqLocked) {
          // El evento con candado manda en ubicación, magnitud y estado; el otro aporta sus estaciones sin perder ninguna
          const anchor = existingLocked ? existing : eq;
          const other = existingLocked ? eq : existing;
          const stations = unionStations(anchor.stations, other.stations);
          result[matchIdx] = { ...anchor, stations, stationCount: Math.max(anchor.stationCount || 0, stations.length), saved: true };
        } else {
          const stations = unionStations(existing.stations, eq.stations);
          result[matchIdx] = {
            ...existing,
            ...eq,
            stations,
            magnitude: Math.max(existing.magnitude || 0, eq.magnitude || 0),
            maxPga: Math.max(existing.maxPga || 0, eq.maxPga || 0),
            maxIntensity: Math.max(existing.maxIntensity || 1, eq.maxIntensity || 1),
            stationCount: Math.max(existing.stationCount || 0, eq.stationCount || 0, (existing.stations || []).length, (eq.stations || []).length, stations.length),
            reportNumber: Math.max(existing.reportNumber || 1, eq.reportNumber || 1),
            // Ambos lados comparten el estado de candado (el caso mixto va arriba): el resultado sigue a ese estado
            status: existingLocked ? 'CONFIRMED' : 'PRELIMINARY',
            saved: true,
          };
        }
      } else {
        result.push(eq);
      }
    }
    return result;
  }

  /** Fusiona duplicados y marca para borrar en MongoDB el id de cada registro que la fusión retira. */
  private dedupeHistory(list: DetectedEarthquake[]): DetectedEarthquake[] {
    const result = this.deduplicateEarthquakes(list);
    const kept = new Set(result.map((e) => e.id));
    for (const e of list) {
      if (e?.id && !kept.has(e.id)) this.pendingHistoryDeletes.add(e.id);
    }
    return result;
  }

  /**
   * Carga el historial del monitor desde MongoDB. Si no hay conexión, deja historyReady en false
   * y la API sirve el historial del SSN hasta que MongoDB responda (se reintenta cada 60 s).
   */
  private async loadHistoryFromMongo(): Promise<void> {
    this.historyLoading = true;
    try {
      await this.historyStore.connect();
      if (this.pendingHistoryClear) {
        const clearAt = this.clearedAtMs;
        // La bandera se baja antes de escribir: una limpieza pedida durante la escritura no debe perderse
        this.pendingHistoryClear = false;
        try {
          await this.historyStore.clear(clearAt);
        } catch (err) {
          this.pendingHistoryClear = true;
          throw err;
        }
      }
      const storedCutoff = await this.historyStore.getClearedAt();
      this.clearedAtMs = Math.max(this.clearedAtMs, storedCutoff);
      const stored = await this.historyStore.loadAll();
      // Si se limpió el historial durante la lectura, no reintroducir lo leído; lo cancelado sin conexión tampoco debe reaparecer
      const loaded = this.pendingHistoryClear ? [] : stored.filter((eq) => !this.pendingHistoryDeletes.has(eq.id));
      // Un preliminar guardado sigue preliminar tras reiniciar: sin su grupo en memoria ya no puede confirmarse por red
      loaded.forEach((eq) => {
        eq.saved = true;
      });
      this.earthquakes = this.dedupeHistory([...loaded, ...this.earthquakes]);
      this.historyReady = true;
      console.log(`[Detector] Historial cargado desde MongoDB: ${loaded.length} eventos`);
      this.saveEarthquakesToDisk();
      void this.syncUSGSEarthquakes();
    } catch (err) {
      this.historyReady = false;
      await this.historyStore.close();
      console.warn(`[Detector] MongoDB no disponible; se servirá el historial del SSN. Motivo: ${(err as Error).message}`);
    } finally {
      this.historyLoading = false;
    }
  }

  /**
   * Persiste el historial del monitor en MongoDB sin bloquear el hilo principal.
   * Las escrituras se encolan en orden para no cruzarse. No escribe si MongoDB no está listo, para no pisar el historial guardado.
   * Guardar solo inserta o actualiza; los documentos se eliminan únicamente si están en pendingHistoryDeletes o hubo una limpieza.
   */
  private saveEarthquakesToDisk(): void {
    if (!this.historyReady) return;
    this.earthquakes = this.dedupeHistory(this.earthquakes);
    const snapshot = structuredClone(this.earthquakes);
    const live = new Set(snapshot.map((e) => e.id));
    const toDelete = [...this.pendingHistoryDeletes].filter((id) => !live.has(id));
    const clearFirst = this.pendingHistoryClear;
    const clearAt = this.clearedAtMs;
    this.pendingHistoryDeletes.clear();
    this.pendingHistoryClear = false;
    this.persistChain = this.persistChain
      .then(async () => {
        if (clearFirst) await this.historyStore.clear(clearAt);
        await this.historyStore.saveAll(snapshot);
        await this.historyStore.deleteIds(toDelete);
      })
      .catch((err) => {
        console.error('[Detector] Error guardando historial en MongoDB:', (err as Error).message);
        toDelete.forEach((id) => this.pendingHistoryDeletes.add(id));
        if (clearFirst) this.pendingHistoryClear = true;
        if (!this.persistRetryTimer) {
          this.persistRetryTimer = setTimeout(() => {
            this.persistRetryTimer = null;
            this.saveEarthquakesToDisk();
          }, 10000);
        }
      });
  }

  // =========================================================================
  // SIMULACIÓN, CONSULTA Y CANCELACIÓN
  // =========================================================================

  /**
   * Permite inyectar o simular un evento sísmico (para pruebas de la cadena completa)
   */
  public simulateSeismicEvent(custom?: Partial<DetectedEarthquake>): DetectedEarthquake {
    const nowMs = Date.now();
    const id = custom?.id ?? `eq-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const displayId = custom?.displayId ?? generateDisplayId(id);
    const lat = custom?.latitude ?? 16.85;
    const lon = custom?.longitude ?? -99.90;
    const mag = custom?.magnitude ?? 5.5;
    const depth = custom?.depth ?? 15;
    const location = custom?.location ?? resolveLocationName(lat, lon);
    const initialStatus = custom?.status ?? 'PRELIMINARY';

    // Relación continua de atenuación hipocentral Wald et al. (1999) (Item 25 & 27)
    const att = 1 / (1 + Math.pow(depth / 45, 1.4));
    const epicentralPga = Math.pow(10, mag * 0.62 - 1.75) * att;
    const maxIntensity = SeismicDspEngine.pgaToMercalli(epicentralPga);

    const azimuthalGap = custom?.azimuthalGap ?? 115;
    const rmsResidualSec = custom?.rmsResidualSec ?? 0.42;
    const clusterLevel = custom?.clusterLevel ?? (initialStatus === 'CONFIRMED' ? 3 : 2);

    const event: DetectedEarthquake = {
      id,
      displayId,
      time: new Date(nowMs - 3000).toISOString(),
      timeEpoch: nowMs - 3000,
      detectedAt: new Date().toISOString(),
      latitude: lat,
      longitude: lon,
      depth: depth,
      magnitude: mag,
      magnitudeType: 'ML',
      location,
      maxPga: Number(epicentralPga.toFixed(2)),
      maxIntensity,
      stationCount: custom?.stationCount ?? 7,
      stations: custom?.stations ?? [],
      status: initialStatus,
      source: 'Simulación / Prueba Controlada de Detección',
      azimuthalGap,
      rmsResidualSec,
      clusterLevel,
      sWaveArrivedCount: custom?.sWaveArrivedCount ?? 3,
      isSWaveConfirmed: custom?.isSWaveConfirmed ?? true,
    };

    // Agregar a la lista activa en memoria si es preliminary para poder cancelarlo si se desea
    if (initialStatus === 'PRELIMINARY') {
      this.activePreliminaryIds.add(id);
    }

    // NOTA: Las simulaciones NO se guardan en disco ni en el historial permanente
    this.onEventDetectedCallback?.(event);

    // Si el evento inicia como PRELIMINARY, a los 10 segundos se confirma
    if (initialStatus === 'PRELIMINARY') {
      setTimeout(() => {
        if (this.activePreliminaryIds.has(id)) {
          this.activePreliminaryIds.delete(id);
          const confirmedEvent: DetectedEarthquake = {
            ...event,
            status: 'CONFIRMED',
            source: 'Confirmación Oficial de Detección',
          };
          this.onEventDetectedCallback?.(confirmedEvent);
        }
      }, 10000);
    }

    return event;
  }

  /**
   * Obtiene la lista de sismos activos (ocurridos en los últimos 300 segundos o preliminares)
   */
  public getActiveEarthquakes(): DetectedEarthquake[] {
    const nowMs = Date.now();
    return this.earthquakes.filter((e) => {
      const elapsed = nowMs - (e.timeEpoch || 0);
      return elapsed < ACTIVE_EVENT_WINDOW_MS || this.activePreliminaryIds.has(e.id);
    });
  }

  /**
   * Cancela o desconfirma un sismo activo por ID, displayId, índice o todos los sismos activos.
   */
  public cancelEarthquake(identifier?: string): { cancelled: boolean; event?: DetectedEarthquake; count: number; message: string } {
    const cleanId = (identifier || '').trim().toUpperCase();

    // Caso A: Si no se proporciona ID o se pasa 'ALL', 'TODOS' o '*', cancelar todos los activos
    if (!cleanId || cleanId === 'ALL' || cleanId === 'TODOS' || cleanId === '*') {
      const nowMs = Date.now();
      const removed: DetectedEarthquake[] = [];

      this.activePreliminaryIds.clear();
      this.pipeline.reset();
      this.quakeEventIds.clear();
      this.records.clear();

      this.earthquakes = this.earthquakes.filter((e) => {
        const isRecent = nowMs - (e.timeEpoch || 0) < ACTIVE_EVENT_WINDOW_MS;
        if (isRecent || e.status === 'PRELIMINARY') {
          removed.push(e);
          return false;
        }
        return true;
      });

      removed.forEach((e) => this.pendingHistoryDeletes.add(e.id));
      this.saveEarthquakesToDisk();
      return {
        cancelled: true,
        count: Math.max(1, removed.length),
        event: removed[0],
        message: removed.length > 0
          ? `Se cancelaron ${removed.length} sismo(s) activo(s).`
          : 'Se emitió la orden de cancelación de todos los sismos activos a los clientes.',
      };
    }

    // Caso B: Buscar por ID completo, displayId o coincidencia
    const idx = this.earthquakes.findIndex((e) => {
      const fullId = (e.id || '').toUpperCase();
      const dispId = (e.displayId || generateDisplayId(e.id)).toUpperCase();
      return (
        fullId === cleanId ||
        dispId === cleanId ||
        dispId === `#${cleanId}` ||
        `#${dispId}` === cleanId ||
        fullId.endsWith(cleanId) ||
        fullId.includes(cleanId)
      );
    });

    if (idx >= 0) {
      const target = this.earthquakes[idx];
      this.activePreliminaryIds.delete(target.id);
      this.earthquakes.splice(idx, 1);
      this.pendingHistoryDeletes.add(target.id);
      for (const [quakeId, eventId] of this.quakeEventIds) {
        if (eventId !== target.id) continue;
        this.quakeEventIds.delete(quakeId);
        const quake = this.pipeline.quakes.find((q) => q.id === quakeId);
        if (quake) this.pipeline.rejectQuake(quake);
      }
      this.saveEarthquakesToDisk();
      return {
        cancelled: true,
        count: 1,
        event: target,
        message: `Sismo [${target.displayId || target.id}] (${target.location || 'México'}) cancelado / desconfirmado exitosamente.`,
      };
    }

    // Si no está en el catálogo permanente pero es un ID válido emitido en simulación
    return {
      cancelled: true,
      count: 1,
      event: { id: identifier!, displayId: identifier!, location: 'Sismo cancelado', magnitude: 0, timeEpoch: Date.now() } as any,
      message: `Orden de cancelación enviada para el sismo [${identifier}].`,
    };
  }

  public getEarthquakeHistory(): DetectedEarthquake[] {
    return [...this.earthquakes];
  }

  /** true cuando el historial del monitor está cargado desde MongoDB. */
  public isMonitorHistoryReady(): boolean {
    return this.historyReady;
  }

  public clearEarthquakeHistory(): void {
    this.earthquakes = [];
    this.pendingHistoryDeletes.clear();
    this.pendingHistoryClear = true;
    this.clearedAtMs = Math.max(this.clearedAtMs, Date.now());
    this.saveEarthquakesToDisk();
    console.log('[Detector] Historial sísmico eliminado de memoria; MongoDB se limpiará al guardar o al conectar.');
  }

  /**
   * Agrega o actualiza un evento externo consolidado (ej. USGS M5.5+ o internacional)
   */
  public addOrUpdateExternalEarthquake(event: DetectedEarthquake): boolean {
    if (!event) return false;
    const existingIndex = this.earthquakes.findIndex((e) => {
      if (e.id === event.id || (e.displayId && event.displayId && e.displayId === event.displayId)) return true;
      const timeDiff = Math.abs((e.timeEpoch || 0) - (event.timeEpoch || 0));
      const dist = this.haversineDistanceKm(e.latitude, e.longitude, event.latitude, event.longitude);
      // Coincidencia con evento local dentro de 150s y 320 km
      if (timeDiff < 150000 && dist < 320.0) return true;
      return false;
    });

    if (existingIndex >= 0) {
      const prev = this.earthquakes[existingIndex];
      if (prev.id !== event.id) this.pendingHistoryDeletes.add(prev.id);
      // Si el evento existente proviene de la red local, conservar las estaciones y detalles locales
      this.earthquakes[existingIndex] = {
        ...prev,
        ...event,
        magnitude: Math.max(prev.magnitude || 0, event.magnitude || 0),
        maxPga: Math.max(prev.maxPga || 0, event.maxPga || 0),
        stationCount: Math.max(prev.stationCount || 0, event.stationCount || 0),
        stations: prev.stations && prev.stations.length > 0 ? prev.stations : event.stations,
        status: 'CONFIRMED',
        confirmationBasis: 'USGS',
        saved: true,
      };
      this.saveEarthquakesToDisk();
      return false;
    } else {
      this.earthquakes.unshift({ ...event, status: 'CONFIRMED', saved: true });
      if (this.earthquakes.length > MAX_STORED_EVENTS) this.earthquakes.pop();
      this.saveEarthquakesToDisk();
      this.onEventDetectedCallback?.(event);
      return true;
    }
  }

  // =========================================================================
  // UTILIDADES GEOGRÁFICAS
  // =========================================================================

  /** Distancia entre dos puntos (km); expuesta como método para las pruebas que la sustituyen */
  private haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return greatCircleKm(lat1, lon1, lat2, lon2);
  }
}
