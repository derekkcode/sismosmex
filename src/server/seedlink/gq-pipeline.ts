/**
 * CANAL DE DETECCIÓN GLOBALQUAKE: ESTACIONES -> EVENTOS -> GRUPOS -> HIPOCENTRO
 *
 * Orquesta el análisis de eventos por estación (`gq-analysis.ts`), el agrupamiento (`gq-cluster.ts`) y la búsqueda de
 * hipocentro (`gq-hypocenter.ts`). Es lógica pura: no usa relojes, MongoDB ni WebSocket (el tiempo entra por `run(nowMs)`),
 * de modo que se puede probar con señales sintéticas y registros reales.
 *
 * Un grupo de eventos se declara sismo localizado solo si su hipocentro supera las comprobaciones de GlobalQuake
 * (porcentaje de llegadas correctas, mínimo de estaciones, cobertura angular, incertidumbre y llegadas "obvias" ausentes).
 * Un grupo coherente que no alcanza para localizarse queda como candidato.
 */

import { GqAnalysisParams, GqStationEvent } from './gq-analysis.js';
import {
  ClusterParams,
  DEFAULT_CLUSTER_PARAMS,
  GqCluster,
  GqClusterAnalysis,
  GqQuake,
  GqStation,
  GqStationInfo,
  QuakeRemovalReason,
  buildNearbyLists,
  depthCorrection,
  expectedRatio,
  hypocentralKm,
  magnitudeFromRatio,
} from './gq-cluster.js';
import { greatCircleKm } from './gq-geo.js';
import {
  DEFAULT_FINDER_SETTINGS,
  FinderSettings,
  HypocenterSolution,
  PickedEvent,
  expectedPArrivalMs,
  locateHypocenter,
} from './gq-hypocenter.js';
import { calculateTravelTime1D } from './travel-time.js';

export interface GqPipelineParams {
  analysis: Partial<GqAnalysisParams>;
  cluster: Partial<ClusterParams>;
  finder: Partial<FinderSettings>;
  /** Llegadas correctas mínimas para declarar un sismo localizado */
  minStations: number;
  /** Porcentaje mínimo de llegadas correctas entre las usadas */
  correctnessThresholdPct: number;
  /** Incertidumbre máxima (km) de la región de confianza del epicentro */
  locationUncertaintyLimitKm: number;
  /** Cociente mínimo del evento más fuerte del grupo para intentar localizar */
  minStrongestRatio: number;
  minQuadrantScore: number;
  /** Llegadas "obvias" (cociente esperado >= umbral en una estación activa) ausentes que invalidan el hipocentro */
  obviousRatioThreshold: number;
  obviousMinTotal: number;
  obviousCorrectMin: number;
  obviousDeleteMin: number;
  /** Separación mínima (s) entre búsquedas de un grupo cuando solo cambiaron los tiempos de llegada */
  researchIntervalMs: number;
}

export const DEFAULT_PIPELINE_PARAMS: GqPipelineParams = {
  analysis: {},
  cluster: {},
  finder: {},
  minStations: 4,
  correctnessThresholdPct: 50,
  locationUncertaintyLimitKm: 150,
  minStrongestRatio: 16,
  minQuadrantScore: 2.0,
  obviousRatioThreshold: 256,
  obviousMinTotal: 3,
  obviousCorrectMin: 0.3,
  obviousDeleteMin: 0.2,
  researchIntervalMs: 4000,
};

export type PipelineChange =
  | { type: 'created'; quake: GqQuake }
  | { type: 'updated'; quake: GqQuake; magnitudeOnly: boolean }
  | { type: 'removed'; quake: GqQuake; reason: QuakeRemovalReason | 'rejected' };

export interface GqCandidateCluster {
  cluster: GqCluster;
  stations: GqStation[];
  firstPickMs: number;
}

export class GqPipeline {
  public readonly params: GqPipelineParams;
  private readonly stationMap = new Map<string, GqStation>();
  private stationList: GqStation[] = [];
  private nearbyDirty = false;
  private nextStationId = 1;
  private readonly clusterAnalysis: GqClusterAnalysis;
  private pending: PipelineChange[] = [];
  private readonly lastSearchMs = new Map<number, number>();

  constructor(params: Partial<GqPipelineParams> = {}) {
    this.params = {
      ...DEFAULT_PIPELINE_PARAMS,
      ...params,
      finder: { ...DEFAULT_FINDER_SETTINGS, ...params.finder },
    };
    const clusterParams: ClusterParams = { ...DEFAULT_CLUSTER_PARAMS, ...this.params.cluster };
    this.clusterAnalysis = new GqClusterAnalysis(
      () => this.stationList,
      clusterParams,
      (quake, reason) => this.pending.push({ type: 'removed', quake, reason })
    );
  }

  public get stations(): GqStation[] {
    return this.stationList;
  }

  public get clusters(): GqCluster[] {
    return this.clusterAnalysis.clusters;
  }

  public get quakes(): GqQuake[] {
    const result: GqQuake[] = [];
    for (const cluster of this.clusterAnalysis.clusters) if (cluster.quake) result.push(cluster.quake);
    return result;
  }

  public getStation(key: string): GqStation | undefined {
    return this.stationMap.get(key);
  }

  public upsertStation(info: GqStationInfo): GqStation {
    const key = `${info.network}.${info.code}`;
    let station = this.stationMap.get(key);
    if (!station) {
      station = new GqStation(this.nextStationId++, info, this.params.analysis);
      this.stationMap.set(key, station);
      this.stationList.push(station);
      this.nearbyDirty = true;
    } else if (station.lat !== info.lat || station.lon !== info.lon) {
      station.info.lat = info.lat;
      station.info.lon = info.lon;
      station.info.elevationM = info.elevationM;
      this.nearbyDirty = true;
    }
    return station;
  }

  /** Alimenta el análisis de un canal vertical de la estación con un paquete contiguo de muestras */
  public ingest(info: GqStationInfo, channel: string, samples: ArrayLike<number>, startMs: number, sampleRate: number): void {
    this.upsertStation(info).feed(channel, samples, startMs, sampleRate);
  }

  /** Ejecuta un ciclo completo (agrupamiento y localización). Devuelve los cambios de sismos ocurridos */
  public run(nowMs: number): PipelineChange[] {
    if (this.nearbyDirty) {
      buildNearbyLists(this.stationList);
      this.nearbyDirty = false;
    }
    for (const station of this.stationList) {
      for (const analysis of station.allAnalyses()) analysis.prune(nowMs);
    }
    this.clusterAnalysis.run(nowMs);
    for (const cluster of [...this.clusterAnalysis.clusters]) {
      if (this.clusterAnalysis.clusters.includes(cluster)) this.processCluster(cluster, nowMs);
    }
    const changes = this.pending;
    this.pending = [];
    for (const change of changes) {
      if (change.type === 'removed') this.lastSearchMs.delete(change.quake.cluster.id);
    }
    return changes;
  }

  /** Descarta un sismo por decisión externa (cancelación manual): sus eventos no vuelven a formar grupo */
  public rejectQuake(quake: GqQuake): void {
    for (const event of quake.cluster.events.values()) event.valid = false;
    this.clusterAnalysis.removeCluster(quake.cluster);
    this.pending.push({ type: 'removed', quake, reason: 'rejected' });
  }

  /** Cancela todo lo que está en curso: los eventos abiertos y los grupos se descartan sin reportar cambios */
  public reset(): void {
    for (const cluster of [...this.clusterAnalysis.clusters]) {
      for (const event of cluster.events.values()) event.valid = false;
      this.clusterAnalysis.removeCluster(cluster);
    }
    for (const station of this.stationList) {
      for (const analysis of station.allAnalyses()) {
        for (const event of analysis.events) if (!event.hasEnded()) event.endBadly();
      }
    }
    this.pending = [];
    this.lastSearchMs.clear();
  }

  /** Grupos coherentes de al menos `minSites` estaciones que aún no son un sismo localizado */
  public candidates(minSites: number, nowMs: number, maxAgeMs = 3 * 60_000): GqCandidateCluster[] {
    const result: GqCandidateCluster[] = [];
    for (const cluster of this.clusterAnalysis.clusters) {
      if (cluster.quake || nowMs - cluster.createdMs > maxAgeMs) continue;
      const members = cluster.validEvents();
      if (members.length < minSites) continue;
      if (Math.max(...members.map(([, e]) => e.maxRatio)) < this.params.minStrongestRatio) continue;
      const stations = this.mutuallyCompatible(members);
      if (stations.length < minSites) continue;
      result.push({
        cluster,
        stations: stations.map(([s]) => s),
        firstPickMs: Math.min(...stations.map(([, e]) => e.pWaveMs)),
      });
    }
    return result;
  }

  /** Mayor subconjunto cuyas llegadas son compatibles por pares: |dt| <= d / 5.5 km/s + 1.8 s */
  private mutuallyCompatible(members: Array<[GqStation, GqStationEvent]>): Array<[GqStation, GqStationEvent]> {
    const n = members.length;
    const compatible = members.map(() => new Uint8Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = greatCircleKm(members[i][0].lat, members[i][0].lon, members[j][0].lat, members[j][0].lon);
        if (Math.abs(members[i][1].pWaveMs - members[j][1].pWaveMs) / 1000 <= dist / 5.5 + 1.8) {
          compatible[i][j] = compatible[j][i] = 1;
        }
      }
    }
    let best: number[] = [];
    for (let seed = 0; seed < n; seed++) {
      const group = [seed];
      for (let k = 0; k < n; k++) {
        if (k !== seed && compatible[seed][k] && group.every((g) => compatible[k][g])) group.push(k);
      }
      if (group.length > best.length) best = group;
    }
    return best.map((i) => members[i]);
  }

  // ---- localización de grupos -------------------------------------------------------------------------------------

  private processCluster(cluster: GqCluster, nowMs: number): void {
    const members = cluster.validEvents();
    if (members.length === 0) return;
    const quake = cluster.quake;

    // Solo se vuelve a localizar cuando el número de eventos crece un 20 % o cambiaron los tiempos de llegada
    const lastSearch = this.lastSearchMs.get(cluster.id) ?? 0;
    const grew = quake ? members.length > quake.nextReportEventCount : true;
    const changed = cluster.lastEpicenterUpdate * 1.1 < cluster.updateCount;
    if (quake && !grew && !(changed && nowMs - lastSearch >= this.params.researchIntervalMs)) return;
    if (!quake && !changed && lastSearch > 0) return;

    cluster.lastEpicenterUpdate = cluster.updateCount;
    if (members.length < this.params.minStations) return;
    const strongest = Math.max(...members.map(([, e]) => e.maxRatio));
    if (strongest < this.params.minStrongestRatio) return;

    this.lastSearchMs.set(cluster.id, nowMs);
    const picks: PickedEvent[] = members.map(([station, event]) => ({
      key: station.key,
      pWaveMs: event.pWaveMs,
      lat: station.lat,
      lon: station.lon,
      elevationM: station.elevationM,
      maxRatio: event.maxRatio,
    }));
    const settings = this.params.finder as FinderSettings;
    const solution = locateHypocenter(picks, {
      settings: { ...settings, resolution: picks.length > 20 ? 0.6 : settings.resolution },
      previous: cluster.previous ? { lat: cluster.previous.lat, lon: cluster.previous.lon } : null,
    });
    if (!solution) return;
    if (quake) quake.nextReportEventCount = Math.floor(members.length * 1.2);
    this.evaluateSolution(cluster, members, solution, nowMs);
  }

  private evaluateSolution(
    cluster: GqCluster,
    members: Array<[GqStation, GqStationEvent]>,
    solution: HypocenterSolution,
    nowMs: number
  ): void {
    const p = this.params;
    const finder = p.finder as FinderSettings;
    const quake = cluster.quake;
    // Una solución muy profunda es casi siempre una onda del núcleo o un ajuste degenerado
    if (solution.depthKm > finder.maxDepthKm - 5) return;

    const gqMagnitude = this.ratioMagnitude(members, solution);
    const obviousPct = this.obviousCorrectFraction(solution, gqMagnitude);
    const pct = (100 * solution.correctEvents) / solution.usedEvents;
    const valid = pct >= p.correctnessThresholdPct &&
      solution.correctEvents >= p.minStations &&
      obviousPct >= p.obviousCorrectMin &&
      solution.locationUncertaintyKm <= p.locationUncertaintyLimitKm &&
      solution.quadrantScore >= p.minQuadrantScore;

    if (!valid) {
      const remove = quake !== null && (
        pct < p.correctnessThresholdPct * 0.75 ||
        solution.correctEvents < p.minStations * 0.75 ||
        obviousPct < p.obviousDeleteMin
      );
      if (remove && quake) {
        cluster.quake = null;
        cluster.previous = null;
        cluster.resetAnchor();
        this.pending.push({ type: 'removed', quake, reason: 'dissolved' });
      }
      return;
    }

    const previous = cluster.previous;
    const qualityRank = (q: HypocenterSolution) => 'SABCD'.indexOf(q.quality);
    if (previous && qualityRank(solution) > qualityRank(previous)) {
      // La solución previa era mejor: solo se actualiza lo que no depende de la geometría
      if (quake) {
        quake.gqMagnitude = this.ratioMagnitude(members, previous);
        quake.lastUpdateMs = nowMs;
        this.pending.push({ type: 'updated', quake, magnitudeOnly: true });
      }
      return;
    }

    cluster.updateAnchor(solution);
    cluster.previous = solution;
    if (!quake) {
      const created = new GqQuake(cluster, solution, nowMs, gqMagnitude);
      created.nextReportEventCount = Math.floor(members.length * 1.2);
      cluster.quake = created;
      this.pending.push({ type: 'created', quake: created });
    } else {
      quake.hypocenter = solution;
      quake.gqMagnitude = gqMagnitude;
      quake.lastUpdateMs = nowMs;
      quake.revision++;
      this.pending.push({ type: 'updated', quake, magnitudeOnly: false });
    }
  }

  /** Magnitud interna a partir de los cocientes, solo para las verificaciones de coherencia entre estaciones */
  private ratioMagnitude(members: Array<[GqStation, GqStationEvent]>, h: HypocenterSolution): number {
    const readings: number[] = [];
    for (const [station, event] of members) {
      if (!h.correctKeys.includes(station.key)) continue;
      const distGc = greatCircleKm(h.lat, h.lon, station.lat, station.lon);
      const distGe = hypocentralKm(h.lat, h.lon, h.depthKm, station);
      const sArrivalMs = h.originMs + calculateTravelTime1D(distGc, h.depthKm, 'S') * 1000;
      const latestMs = station.analysis?.latestLogTimeMs ?? 0;
      const mul = latestMs > sArrivalMs + 8000 ? 0.95 : Math.max(1, 3 - distGc / 400);
      readings.push(magnitudeFromRatio(event.maxRatio * mul, distGe) - depthCorrection(h.depthKm));
    }
    if (readings.length === 0) return 0;
    readings.sort((a, b) => a - b);
    return readings[Math.floor((readings.length - 1) / 2)];
  }

  /**
   * Fracción de estaciones activas donde la llegada era evidente (cociente esperado alto) y sí hubo un evento.
   * Un hipocentro que exige llegadas fuertes en estaciones que no registraron nada es falso.
   */
  private obviousCorrectFraction(h: HypocenterSolution, gqMagnitude: number): number {
    const p = this.params;
    let total = 0;
    let wrong = 0;
    for (const station of this.stationList) {
      const distGc = greatCircleKm(h.lat, h.lon, station.lat, station.lon);
      if (distGc > 1000) continue;
      if (expectedRatio(gqMagnitude, hypocentralKm(h.lat, h.lon, h.depthKm, station)) < p.obviousRatioThreshold) continue;
      const expectedMs = expectedPArrivalMs(h, station);
      if (!station.wasActiveAt(expectedMs)) continue;
      total++;
      if (!station.hasEventNear(expectedMs, 20_000)) wrong++;
    }
    if (total < p.obviousMinTotal) return 1;
    return (total - wrong) / total;
  }
}
