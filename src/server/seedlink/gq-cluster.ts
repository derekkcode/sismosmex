/**
 * AGRUPAMIENTO DE EVENTOS DE ESTACIÓN (ARQUITECTURA GLOBALQUAKE: ClusterAnalysis)
 *
 * Un grupo (cluster) reúne los eventos de estaciones vecinas cuyas llegadas P son compatibles con una misma fuente:
 * dos estaciones a distancia d pueden ver la llegada con una diferencia de hasta d / 5 km/s + 2.5 s. Un grupo nace
 * de un evento sin asignar y de las estaciones cercanas con eventos compatibles, y crece por cadena (los vecinos de
 * los vecinos) y por coincidencia con el hipocentro ya calculado. Las ondas S posteriores se marcan para que no formen
 * grupos nuevos. Los grupos con un sismo localizado absorben a los que este explica (> 54 % de sus eventos).
 */

import { GqAnalysisParams, GqStationAnalysis, GqStationEvent } from './gq-analysis.js';
import { bearingDeg, greatCircleKm, meanLatLon } from './gq-geo.js';
import { HypocenterSolution } from './gq-hypocenter.js';
import { calculateTravelTime1D, elevationCorrectionSec } from './travel-time.js';

export interface GqStationInfo {
  network: string;
  code: string;
  lat: number;
  lon: number;
  elevationM: number;
}

export interface NearbyStation {
  station: GqStation;
  distKm: number;
  azimuth: number;
}

const RAYS = 9;
const STATIONS_PER_RAY = 3;
const MAX_NEARBY_KM = 4000;
const FAR_STATION_KM = 1000;

/** Prioridad de canal: banda ancha de alta tasa primero, después BH y al final los acelerómetros */
export function channelPriority(channel: string): number {
  const c = (channel || '').toUpperCase();
  if (c.startsWith('HH')) return 100;
  if (c.startsWith('EH')) return 95;
  if (c.startsWith('SH')) return 90;
  if (c.startsWith('BH')) return 80;
  if (c.length >= 2 && c[1] === 'N') return 60;
  return 50;
}

const CHANNEL_ACTIVE_MS = 30_000;

export class GqStation {
  public nearby: NearbyStation[] = [];
  private readonly analyses = new Map<string, GqStationAnalysis>();
  private readonly lastDataMs = new Map<string, number>();
  private latestDataMs = 0;
  private detection: GqStationAnalysis | null = null;
  /** Hora de datos en que el canal de detección terminó su inicialización (0 mientras inicializa) */
  public activeSinceMs = 0;

  constructor(
    public readonly id: number,
    public readonly info: GqStationInfo,
    private readonly analysisParams: Partial<GqAnalysisParams>
  ) {}

  public get key(): string {
    return `${this.info.network}.${this.info.code}`;
  }

  public get lat(): number {
    return this.info.lat;
  }

  public get lon(): number {
    return this.info.lon;
  }

  public get elevationM(): number {
    return this.info.elevationM;
  }

  /** Alimenta el análisis del canal y reelige el canal de detección (el de mayor prioridad con datos recientes) */
  public feed(channel: string, samples: ArrayLike<number>, startMs: number, sampleRate: number): void {
    const name = channel.toUpperCase();
    let analysis = this.analyses.get(name);
    if (!analysis) {
      analysis = new GqStationAnalysis(this.analysisParams);
      this.analyses.set(name, analysis);
    }
    const endMs = startMs + (samples.length * 1000) / sampleRate;
    this.lastDataMs.set(name, endMs);
    if (endMs > this.latestDataMs) this.latestDataMs = endMs;
    analysis.analyse(samples, startMs, sampleRate);

    let best: string | null = null;
    for (const [other, seenMs] of this.lastDataMs) {
      if (this.latestDataMs - seenMs > CHANNEL_ACTIVE_MS) continue;
      if (best === null || channelPriority(other) > channelPriority(best)) best = other;
    }
    const chosen = best ? this.analyses.get(best)! : analysis;
    if (chosen !== this.detection) {
      this.detection = chosen;
      this.activeSinceMs = 0;
    }
    if (this.detection.status === 'INIT') this.activeSinceMs = 0;
    else if (this.activeSinceMs === 0) this.activeSinceMs = startMs;
  }

  public get analysis(): GqStationAnalysis | null {
    return this.detection;
  }

  public get events(): GqStationEvent[] {
    return this.detection ? this.detection.events : [];
  }

  /** Canal que usa el análisis de detección */
  public get detectionChannel(): string | null {
    if (!this.detection) return null;
    for (const [name, analysis] of this.analyses) if (analysis === this.detection) return name;
    return null;
  }

  public allAnalyses(): IterableIterator<GqStationAnalysis> {
    return this.analyses.values();
  }

  public analysisForChannel(channel: string): GqStationAnalysis | undefined {
    return this.analyses.get(channel.toUpperCase());
  }

  /** ¿La estación estaba activa (inicializada y con datos) en el instante dado? */
  public wasActiveAt(timeMs: number): boolean {
    const analysis = this.detection;
    if (!analysis || this.activeSinceMs === 0) return false;
    return this.activeSinceMs <= timeMs && analysis.latestLogTimeMs >= timeMs + 5000;
  }

  /** Evento (válido o no) cuya ventana contiene el instante, con tolerancia */
  public hasEventNear(timeMs: number, toleranceMs: number): boolean {
    for (const event of this.events) {
      if (event.startMs <= timeMs + toleranceMs && (!event.hasEnded() || event.endMs >= timeMs - toleranceMs)) return true;
    }
    return false;
  }
}

/** Lista de estaciones vecinas por sectores angulares (9 rayos, 3 estaciones por rayo, solo una lejana por rayo) */
export function buildNearbyLists(stations: GqStation[]): void {
  for (const station of stations) {
    const rays: NearbyStation[][] = Array.from({ length: RAYS }, () => []);
    for (const other of stations) {
      if (other === station) continue;
      const distKm = greatCircleKm(station.lat, station.lon, other.lat, other.lon);
      if (distKm > MAX_NEARBY_KM) continue;
      const azimuth = bearingDeg(station.lat, station.lon, other.lat, other.lon);
      const ray = Math.floor((azimuth / 360) * (RAYS - 1));
      const info: NearbyStation = { station: other, distKm, azimuth };
      rays[ray].push(info);
      rays[(ray + 1) % RAYS].push(info);
      rays[(ray + RAYS - 1) % RAYS].push(info);
    }
    const result = new Set<NearbyStation>();
    for (const ray of rays) {
      ray.sort((a, b) => a.distKm - b.distKm);
      let count = 0;
      for (const info of ray) {
        if (count >= STATIONS_PER_RAY) break;
        if (!result.has(info)) {
          result.add(info);
          count++;
        }
        if (info.distKm > FAR_STATION_KM) break;
      }
    }
    station.nearby = [...result].sort((a, b) => a.distKm - b.distKm);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Expectativas de cociente por magnitud y distancia (tabla empírica de GlobalQuake, IntensityTable)
// ---------------------------------------------------------------------------------------------------------------

/** Cociente corto/largo esperado de una estación a `distKm` (hipocentral) de un sismo de magnitud `mag` */
export function expectedRatio(mag: number, distKm: number): number {
  const m = 1.2 * mag - 0.022 * mag * mag - 1;
  let d = distKm;
  if (d > 1200) d = 1200 + Math.pow(d - 1200, 0.4) * 22.0;
  return Math.pow(15, m * 0.92 + 4.0) / (5 * Math.pow(d, 2.1 + 0.07 * m) + 1000 + Math.pow(5, m));
}

/** Magnitud que explica un cociente observado a una distancia hipocentral (bisección: el cociente crece con la magnitud) */
export function magnitudeFromRatio(ratio: number, distKm: number): number {
  let low = -2.0;
  let high = 10.0;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (expectedRatio(mid, distKm) < ratio) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function hypocentralKm(lat: number, lon: number, depthKm: number, station: { lat: number; lon: number; elevationM: number }): number {
  const dist = greatCircleKm(lat, lon, station.lat, station.lon);
  return Math.hypot(dist, depthKm + station.elevationM / 1000);
}

// ---------------------------------------------------------------------------------------------------------------

let nextClusterId = 1;
let nextQuakeId = 1;

export class GqQuake {
  public readonly id = nextQuakeId++;
  public readonly createdMs: number;
  public lastUpdateMs: number;
  public hypocenter: HypocenterSolution;
  /** Magnitud interna (solo para las verificaciones de coherencia entre estaciones) */
  public gqMagnitude: number;
  public revision = 1;
  public nextReportEventCount = 0;

  constructor(public readonly cluster: GqCluster, hypocenter: HypocenterSolution, nowMs: number, gqMagnitude: number) {
    this.createdMs = nowMs;
    this.lastUpdateMs = nowMs;
    this.hypocenter = hypocenter;
    this.gqMagnitude = gqMagnitude;
  }

  public get lat(): number {
    return this.hypocenter.lat;
  }

  public get lon(): number {
    return this.hypocenter.lon;
  }

  public get depthKm(): number {
    return this.hypocenter.depthKm;
  }

  public get originMs(): number {
    return this.hypocenter.originMs;
  }
}

export class GqCluster {
  public readonly id = nextClusterId++;
  public readonly events = new Map<GqStation, GqStationEvent>();
  public rootLat = 0;
  public rootLon = 0;
  public anchorLat = Number.NaN;
  public anchorLon = Number.NaN;
  public level = 0;
  public updateCount = 0;
  public lastEpicenterUpdate = 0;
  public lastUpdateMs: number;
  public quake: GqQuake | null = null;
  public previous: HypocenterSolution | null = null;
  public readonly createdMs: number;
  public lastLevel = -1;

  constructor(nowMs: number) {
    this.lastUpdateMs = nowMs;
    this.createdMs = nowMs;
  }

  public addEvent(station: GqStation, event: GqStationEvent): boolean {
    if (this.events.has(station)) return false;
    this.events.set(station, event);
    event.clusterId = this.id;
    return true;
  }

  public containsStation(station: GqStation): boolean {
    return this.events.has(station);
  }

  public validEvents(): Array<[GqStation, GqStationEvent]> {
    const result: Array<[GqStation, GqStationEvent]> = [];
    for (const entry of this.events) {
      if (entry[1].valid && !entry[1].isSWave && entry[1].pWaveMs > 0) result.push(entry);
    }
    return result;
  }

  public calculateRoot(useAsAnchor: boolean): void {
    const points: Array<{ lat: number; lon: number }> = [];
    for (const [station, event] of this.events) if (event.valid) points.push({ lat: station.lat, lon: station.lon });
    if (points.length === 0) return;
    const root = meanLatLon(points);
    this.rootLat = root.lat;
    this.rootLon = root.lon;
    if (useAsAnchor) {
      this.anchorLat = root.lat;
      this.anchorLon = root.lon;
    }
  }

  public resetAnchor(): void {
    this.anchorLat = this.rootLat;
    this.anchorLon = this.rootLon;
  }

  public updateAnchor(h: { lat: number; lon: number }): void {
    this.anchorLat = h.lat;
    this.anchorLon = h.lon;
  }

  /** Nivel (0 - 4) por cantidad de estaciones con cocientes muy altos, igual que GlobalQuake */
  public calculateLevel(): void {
    let sumDist = 0;
    let n = 0;
    let lvl1 = 0;
    let lvl2 = 0;
    let lvl3 = 0;
    let lvl4 = 0;
    for (const [station, event] of this.events) {
      if (!event.valid) continue;
      sumDist += greatCircleKm(this.rootLat, this.rootLon, station.lat, station.lon);
      n++;
      if (event.maxRatio >= 64) lvl1++;
      if (event.maxRatio >= 1000) lvl2++;
      if (event.maxRatio >= 10000) lvl3++;
      if (event.maxRatio >= 50000) lvl4++;
    }
    const avg = n > 0 ? sumDist / n : 0;
    let level = 0;
    if ((lvl1 >= 7 || lvl2 >= 4) && avg > 10) level = 1;
    if ((lvl2 >= 7 || lvl3 >= 3) && avg > 25) level = 2;
    if ((lvl3 >= 5 || lvl4 >= 3) && avg > 50) level = 3;
    if (lvl4 >= 4 && avg > 75) level = 4;
    this.level = level;
  }

  /** Detecta cambios en los eventos (nuevos picks, finales) y refresca raíz y nivel */
  public tick(nowMs: number): void {
    let updates = 0;
    for (const event of this.events.values()) updates += event.updatesCount;
    if (updates !== this.updateCount) {
      this.updateCount = updates;
      this.calculateRoot(Number.isNaN(this.anchorLat));
      this.calculateLevel();
      this.lastUpdateMs = nowMs;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------

export interface ClusterParams {
  /** Estaciones mínimas para formar un grupo */
  clusterMinSize: number;
  /** Velocidad aparente (km/s) de la ventana de compatibilidad entre llegadas de estaciones vecinas */
  linkSpeedKmS: number;
  linkToleranceMs: number;
  pWaveInaccuracyMs: number;
  mergeThreshold: number;
  /** Un grupo sin sismo y con pocos eventos activos se retira tras este tiempo sin cambios */
  idleRemoveMs: number;
}

export const DEFAULT_CLUSTER_PARAMS: ClusterParams = {
  clusterMinSize: 3,
  linkSpeedKmS: 5.0,
  linkToleranceMs: 2500,
  pWaveInaccuracyMs: 1800,
  mergeThreshold: 0.54,
  idleRemoveMs: 2 * 60_000,
};

// Duración (min) que un sismo se mantiene vivo según su magnitud (tabla de GlobalQuake, entradas de 0.5 unidades)
const STORE_TABLE_MIN = [3, 3, 3, 3, 3, 3, 5, 6, 8, 16, 30, 30, 30, 40, 40, 40];

export function depthCorrection(depthKm: number): number {
  return Math.log10(depthKm + 160.0) - Math.log10(160.0);
}

export function quakeStoreMs(mag: number, depthKm: number): number {
  const idx = Math.max(0, Math.min(STORE_TABLE_MIN.length - 1, Math.floor((mag + depthCorrection(depthKm)) * 2.0)));
  return STORE_TABLE_MIN[idx] * 60_000;
}

export type QuakeRemovalReason = 'dissolved' | 'expired' | 'merged';

export class GqClusterAnalysis {
  public readonly clusters: GqCluster[] = [];

  constructor(
    private readonly getStations: () => GqStation[],
    private readonly params: ClusterParams = DEFAULT_CLUSTER_PARAMS,
    private readonly onQuakeRemoved: (quake: GqQuake, reason: QuakeRemovalReason) => void = () => {}
  ) {}

  public run(nowMs: number): void {
    this.clearSWaves();
    this.markSWaves();
    this.expandExistingClusters();
    this.createNewClusters(nowMs);
    this.mergeClusters();
    this.updateClusters(nowMs);
  }

  // ---- ondas S ----------------------------------------------------------------------------------------------

  /** Un evento posterior a la llegada P esperada y compatible con la S de un sismo localizado es onda S, no un sismo nuevo */
  private couldBeSArrival(event: GqStationEvent, station: GqStation, quake: GqQuake): boolean {
    if (!event.valid || event.pWaveMs <= 0) return false;
    const h = quake.hypocenter;
    const distKm = greatCircleKm(h.lat, h.lon, station.lat, station.lon);
    if (expectedRatio(quake.gqMagnitude, Math.hypot(distKm, h.depthKm)) < 3.0) return false;
    const actualMs = event.pWaveMs - h.originMs;
    const expectedMs = (calculateTravelTime1D(distKm, h.depthKm, 'S') + elevationCorrectionSec(station.elevationM) * 1.5) * 1000;
    const diff = actualMs - expectedMs;
    return diff > -2000 - expectedMs * 0.03 && diff < 6000 + expectedMs * 0.05;
  }

  private markSWaves(): void {
    const stations = this.getStations();
    for (const cluster of this.clusters) {
      const quake = cluster.quake;
      if (!quake) continue;
      for (const station of stations) {
        for (const event of station.events) {
          if (event.valid && !event.isSWave && this.couldBeSArrival(event, station, quake) &&
            !this.couldBeArrival(event, station, quake, true, false)) {
            event.isSWave = true;
          }
        }
      }
    }
  }

  private clearSWaves(): void {
    const stations = this.getStations();
    for (const cluster of this.clusters) {
      const quake = cluster.quake;
      if (!quake) continue;
      for (const station of stations) {
        for (const event of station.events) {
          if (event.valid && event.isSWave &&
            (!this.couldBeSArrival(event, station, quake) || this.couldBeArrival(event, station, quake, true, false))) {
            event.isSWave = false;
          }
        }
      }
    }
  }

  // ---- compatibilidad con un sismo ---------------------------------------------------------------------------

  /**
   * ¿Puede este evento ser la llegada P del sismo? `increasingPWindow` amplía la tolerancia (mín. 10 s) para
   * incorporar estaciones que el grupo aún no tiene; `considerIntensity` descarta estaciones donde el sismo,
   * por su tamaño, no podría producir un evento claro.
   */
  public couldBeArrival(
    event: GqStationEvent,
    station: GqStation,
    quake: { hypocenter: HypocenterSolution; gqMagnitude: number },
    considerIntensity: boolean,
    increasingPWindow: boolean
  ): boolean {
    if (!event.valid || event.isSWave || event.pWaveMs <= 0) return false;
    return this.couldBePick(event.pWaveMs, station, quake.hypocenter, considerIntensity ? quake.gqMagnitude : null, increasingPWindow);
  }

  public couldBePick(
    pWaveMs: number,
    station: { lat: number; lon: number; elevationM: number },
    h: { lat: number; lon: number; depthKm: number; originMs: number },
    magnitudeForIntensity: number | null,
    increasingPWindow: boolean
  ): boolean {
    const distKm = greatCircleKm(h.lat, h.lon, station.lat, station.lon);
    if (magnitudeForIntensity !== null && expectedRatio(magnitudeForIntensity, Math.hypot(distKm, h.depthKm)) < 3.0) return false;
    const expectedMs = (calculateTravelTime1D(distKm, h.depthKm, 'P') + elevationCorrectionSec(station.elevationM)) * 1000;
    const actualMs = pWaveMs - h.originMs;
    const window = increasingPWindow ? Math.max(10_000, 1000 + expectedMs * 0.01) : this.params.pWaveInaccuracyMs;
    return Math.abs(expectedMs - actualMs) < window;
  }

  // ---- crecimiento de grupos ----------------------------------------------------------------------------------

  private expandExistingClusters(): void {
    for (const cluster of this.clusters) this.expandCluster(cluster);
  }

  private expandCluster(cluster: GqCluster): void {
    const quake = cluster.quake;
    if (quake && quake.hypocenter.correctEvents > 7) this.expandPWaves(cluster, quake);

    let frontier = [...cluster.events.entries()];
    while (frontier.length > 0) {
      const added: Array<[GqStation, GqStationEvent]> = [];
      for (const [station, event] of frontier) {
        if (!event.valid || event.isSWave) continue;
        for (const info of station.nearby) {
          if (cluster.containsStation(info.station) || added.some(([s]) => s === info.station)) continue;
          const candidate = info.station.events.find((other) => this.potentialArrival(other, event, info.distKm));
          if (candidate) added.push([info.station, candidate]);
        }
      }
      for (const [station, event] of added) cluster.addEvent(station, event);
      frontier = added;
    }
  }

  private expandPWaves(cluster: GqCluster, quake: GqQuake): void {
    for (const station of this.getStations()) {
      if (cluster.containsStation(station)) continue;
      for (const event of station.events) {
        if (event.clusterId === null && this.couldBeArrival(event, station, quake, true, true)) {
          cluster.addEvent(station, event);
          break;
        }
      }
    }
  }

  private potentialArrival(candidate: GqStationEvent, reference: GqStationEvent, distKm: number): boolean {
    if (!candidate.valid || candidate.isSWave || candidate.pWaveMs <= 0 || candidate.clusterId !== null) return false;
    const window = (distKm * 1000.0) / this.params.linkSpeedKmS + this.params.linkToleranceMs;
    return Math.abs(candidate.pWaveMs - reference.pWaveMs) <= window;
  }

  private createNewClusters(nowMs: number): void {
    for (const station of this.getStations()) {
      for (const event of station.events) {
        if (!event.valid || event.isSWave || event.pWaveMs <= 0 || event.clusterId !== null) continue;
        const members: Array<[GqStation, GqStationEvent]> = [[station, event]];
        for (const info of station.nearby) {
          const match = info.station.events.find((other) => this.potentialArrival(other, event, info.distKm));
          if (match) members.push([info.station, match]);
        }
        if (members.length >= this.params.clusterMinSize) {
          const cluster = new GqCluster(nowMs);
          for (const [s, e] of members) cluster.addEvent(s, e);
          cluster.calculateRoot(true);
          this.clusters.push(cluster);
          this.expandCluster(cluster);
        }
      }
    }
  }

  // ---- fusión y mantenimiento ---------------------------------------------------------------------------------

  private canMerge(quake: GqQuake, cluster: GqCluster): boolean {
    if (cluster.quake && cluster.previous) {
      const dist = greatCircleKm(quake.lat, quake.lon, cluster.quake.lat, cluster.quake.lon);
      if (dist > 6000 / (1 + cluster.previous.correctEvents * 0.2)) return false;
    }
    let correct = 0;
    let total = 0;
    for (const [station, event] of cluster.events) {
      total++;
      if (this.couldBeArrival(event, station, quake, true, true)) correct++;
    }
    return total > 0 && correct / total > this.params.mergeThreshold;
  }

  private mergeClusters(): void {
    for (const target of [...this.clusters]) {
      const quake = target.quake;
      if (!quake || !this.clusters.includes(target)) continue;
      const toMerge = this.clusters.filter((c) => c !== target && this.canMerge(quake, c));
      for (const source of toMerge) {
        for (const [station, event] of source.events) {
          if (!target.addEvent(station, event)) event.clusterId = null;
        }
        if (source.quake) this.onQuakeRemoved(source.quake, 'merged');
        this.clusters.splice(this.clusters.indexOf(source), 1);
      }
    }
  }

  public updateClusters(nowMs: number): void {
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      const cluster = this.clusters[i];
      let active = 0;
      const minimum = Math.max(2, Math.floor(cluster.events.size * 0.12));
      for (const [station, event] of [...cluster.events]) {
        if (!event.valid || event.isSWave) {
          event.clusterId = null;
          cluster.events.delete(station);
        } else if (!event.hasEnded()) {
          active++;
        }
      }
      const quake = cluster.quake;
      const notEnoughEvents = cluster.events.size < this.params.clusterMinSize;
      const quakeExpired = quake !== null &&
        nowMs - quake.originMs > quakeStoreMs(quake.gqMagnitude, quake.depthKm) &&
        nowMs - quake.lastUpdateMs > quakeStoreMs(quake.gqMagnitude, quake.depthKm) * 0.25;
      const tooOld = quake === null && active < minimum && nowMs - cluster.lastUpdateMs > this.params.idleRemoveMs;
      if (notEnoughEvents || quakeExpired || tooOld) {
        // Los eventos conservan su asignación: un grupo ya descartado no debe volver a formarse con los mismos eventos
        if (quake) this.onQuakeRemoved(quake, notEnoughEvents ? 'dissolved' : 'expired');
        this.clusters.splice(i, 1);
      } else {
        cluster.tick(nowMs);
      }
    }
  }

  public removeCluster(cluster: GqCluster): void {
    const idx = this.clusters.indexOf(cluster);
    if (idx >= 0) this.clusters.splice(idx, 1);
  }
}

