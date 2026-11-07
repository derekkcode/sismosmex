/**
 * BÚSQUEDA DE HIPOCENTRO (ARQUITECTURA GLOBALQUAKE: EarthquakeAnalysis)
 *
 * Para cada hipótesis (latitud, longitud, profundidad) cada llegada P propone un tiempo de origen; el origen de la
 * hipótesis es la mediana de esas propuestas y las llegadas "correctas" son las que coinciden con ella dentro de
 * `pWaveInaccuracyMs`. Se elige la hipótesis con más llegadas correctas y, a igualdad aproximada (30 %), la de
 * menor error cuadrático. La malla es una espiral de Vogel (densidad uniforme) refinada en varias fases
 * (regional -> exacta -> profundidad); la profundidad se busca por subdivisión de intervalo. Con pocas estaciones
 * la profundidad no está restringida por los datos y se fija en un valor somero.
 *
 * Las incertidumbres (profundidad y región de confianza) y la clase de calidad S - D siguen los criterios de GlobalQuake.
 */

import { calculateTravelTime1D, elevationCorrectionSec } from './travel-time.js';
import { bearingDeg, greatCircleKm, meanLatLon, moveOnGlobe } from './gq-geo.js';

export interface PickedEvent {
  key: string;
  pWaveMs: number;
  lat: number;
  lon: number;
  elevationM: number;
  maxRatio: number;
}

export interface FinderSettings {
  /** Tolerancia (ms) de una llegada respecto al origen mediano para contarla como correcta */
  pWaveInaccuracyMs: number;
  /** Multiplicador de la densidad de puntos de la malla (1 = valor por defecto) */
  resolution: number;
  maxDepthKm: number;
  /** Con menos eventos que esto la profundidad se fija: los datos no la restringen */
  freeDepthMinEvents: number;
  fixedDepthKm: number;
  reduceLimit: number;
  reduceIterations: number;
  reduceAmount: number;
  /** Radio máximo (km) de la región de confianza; evita búsquedas interminables en geometrías degeneradas */
  maxUncertaintySearchKm: number;
}

export const DEFAULT_FINDER_SETTINGS: FinderSettings = {
  pWaveInaccuracyMs: 1800,
  resolution: 1,
  maxDepthKm: 250,
  freeDepthMinEvents: 6,
  fixedDepthKm: 10,
  reduceLimit: 12,
  reduceIterations: 2,
  reduceAmount: 0.2,
  maxUncertaintySearchKm: 600,
};

export type QualityClass = 'S' | 'A' | 'B' | 'C' | 'D';
const QUALITY_CLASSES: QualityClass[] = ['S', 'A', 'B', 'C', 'D'];
const THRESHOLDS_ORIGIN = [1.2, 3.0, 9.0, 20.0];
const THRESHOLDS_DEPTH = [8.0, 20.0, 40.0, 100.0];
const THRESHOLDS_LOCATION = [5.0, 12.0, 24.0, 60.0];
const THRESHOLDS_STATIONS = [12.0, 10.0, 8.0, 6.0];

function qualityIndex(thresholds: number[], value: number, smallerBetter: boolean): number {
  let result = 0;
  for (const threshold of thresholds) {
    if (smallerBetter ? value > threshold : value < threshold) result++;
  }
  return Math.min(QUALITY_CLASSES.length - 1, result);
}

export interface HypocenterSolution {
  lat: number;
  lon: number;
  depthKm: number;
  originMs: number;
  /** Suma de cuadrados (s²) de las desviaciones respecto al origen, ponderando menos las incorrectas */
  totalErr: number;
  correctEvents: number;
  /** Eventos recibidos por el localizador (antes de descartar los de mayor residuo) */
  usedEvents: number;
  /** Eventos que quedaron tras el descarte de residuos altos */
  reducedEvents: number;
  correctKeys: string[];
  /** Residuo (s) de cada evento: llegada observada - llegada esperada */
  residualsSec: Record<string, number>;
  rmsSec: number;
  depthFixed: boolean;
  depthUncertaintyKm: number;
  locationUncertaintyKm: number;
  originUncertaintySec: number;
  azimuthalGapDeg: number;
  /** Cobertura angular: 0.5 por cada una de las dos primeras llegadas en cada sector de 360/26° */
  quadrantScore: number;
  quality: QualityClass;
}

interface Prelim {
  lat: number;
  lon: number;
  depth: number;
  origin: number;
  err: number;
  correct: number;
}

function newPrelim(): Prelim {
  return { lat: 0, lon: 0, depth: 0, origin: 0, err: Number.MAX_VALUE, correct: 0 };
}

function copyPrelim(from: Prelim, to: Prelim): void {
  to.lat = from.lat;
  to.lon = from.lon;
  to.depth = from.depth;
  to.origin = from.origin;
  to.err = from.err;
  to.correct = from.correct;
}

function heuristic(h: Prelim): number {
  return (h.correct * h.correct) / (h.err * h.err);
}

function selectBetter(a: Prelim | null, b: Prelim | null): Prelim | null {
  if (!a) return b;
  if (!b) return a;
  if (a.correct > Math.floor(b.correct * 1.3)) return a;
  if (b.correct > Math.floor(a.correct * 1.3)) return b;
  return heuristic(a) > heuristic(b) ? a : b;
}

const PHI = 1.61803398875;
// Incertidumbre típica (s) de una llegada P automática
const PICK_NOISE_SEC = 0.25;
// Peso (s² por s² de viaje) de la preferencia por orígenes cercanos a la estación más temprana
const TRAVEL_PRIOR = 0.0002;

class SearchState {
  public readonly n: number;
  public readonly lat: Float64Array;
  public readonly lon: Float64Array;
  public readonly elevSec: Float64Array;
  public readonly pWave: Float64Array;
  public readonly dist: Float64Array;
  private readonly origins: Float64Array;
  private readonly sorted: Float64Array;
  public readonly baseMs: number;
  private readonly earliest: number;

  constructor(events: PickedEvent[], private readonly thresholdMs: number) {
    this.n = events.length;
    this.lat = new Float64Array(this.n);
    this.lon = new Float64Array(this.n);
    this.elevSec = new Float64Array(this.n);
    this.pWave = new Float64Array(this.n);
    this.dist = new Float64Array(this.n);
    this.origins = new Float64Array(this.n);
    this.sorted = new Float64Array(this.n);
    this.baseMs = events.reduce((min, e) => Math.min(min, e.pWaveMs), Number.POSITIVE_INFINITY);
    let earliest = 0;
    events.forEach((e, i) => {
      this.lat[i] = e.lat;
      this.lon[i] = e.lon;
      this.elevSec[i] = elevationCorrectionSec(e.elevationM);
      this.pWave[i] = e.pWaveMs - this.baseMs;
      if (e.pWaveMs < events[earliest].pWaveMs) earliest = i;
    });
    this.earliest = earliest;
  }

  public setPoint(lat: number, lon: number): void {
    for (let i = 0; i < this.n; i++) this.dist[i] = greatCircleKm(lat, lon, this.lat[i], this.lon[i]);
  }

  /** Evalúa la hipótesis (punto actual, profundidad) y escribe el resultado en `out` */
  public evaluate(lat: number, lon: number, depth: number, out: Prelim): void {
    const n = this.n;
    const thr = this.thresholdMs;
    for (let i = 0; i < n; i++) {
      const o = this.pWave[i] - (calculateTravelTime1D(this.dist[i], depth, 'P') + this.elevSec[i]) * 1000;
      this.origins[i] = o;
      // Inserción: n es pequeño y así no se asigna memoria
      let j = i - 1;
      while (j >= 0 && this.sorted[j] > o) {
        this.sorted[j + 1] = this.sorted[j];
        j--;
      }
      this.sorted[j + 1] = o;
    }
    const median = this.sorted[(n - 1) >> 1];
    let err = 0;
    let correct = 0;
    for (let i = 0; i < n; i++) {
      let e = Math.abs(this.origins[i] - median);
      if (e < thr) correct++;
      else e = (e - thr) * 0.2 + thr;
      e /= 1000;
      err += e * e;
    }
    // Un tiempo de lectura nunca es exacto: sin este piso un ajuste perfecto con 3 - 4 llegadas parece infinitamente preciso
    err = Math.max(err, n * PICK_NOISE_SEC * PICK_NOISE_SEC);
    // Con pocas llegadas hay soluciones lejanas que ajustan igual de bien (hipérbolas de igual diferencia P):
    // se prefiere la de menor tiempo de viaje hasta la estación más temprana, como ocurre con un sismo cercano
    const earliestTravelSec = Math.max(0, (this.pWave[this.earliest] - median) / 1000);
    err += TRAVEL_PRIOR * earliestTravelSec * earliestTravelSec;
    out.lat = lat;
    out.lon = lon;
    out.depth = depth;
    out.origin = median + this.baseMs;
    out.err = err;
    out.correct = correct;
  }
}

class Searcher {
  private readonly a = newPrelim();
  private readonly b = newPrelim();
  private readonly extra = newPrelim();

  constructor(
    private readonly state: SearchState,
    private readonly settings: FinderSettings,
    private readonly fixedDepth: number | null
  ) {}

  /** Mejor profundidad para un punto: subdivisión de intervalo (reutiliza una de las dos evaluaciones previas) */
  public bestAtPoint(lat: number, lon: number, depthIterations: number, best: Prelim): void {
    const state = this.state;
    state.setPoint(lat, lon);
    if (this.fixedDepth !== null) {
      state.evaluate(lat, lon, this.fixedDepth, this.extra);
      this.keepBest(best, this.extra);
      return;
    }

    let lower = 0;
    let upper = this.settings.maxDepthKm;
    let up = this.a;
    let low = this.b;
    state.evaluate(lat, lon, lower + (upper - lower) / 3, up);
    state.evaluate(lat, lon, lower + ((upper - lower) * 2) / 3, low);
    this.keepBest(best, up);
    this.keepBest(best, low);

    for (let it = 0; it < depthIterations; it++) {
      const goUp = selectBetter(up, low) === up;
      const temp = low;
      low = up;
      up = temp;
      if (goUp) {
        upper = (upper + lower) / 2;
        state.evaluate(lat, lon, lower + (upper - lower) / 3, up);
        this.keepBest(best, up);
      } else {
        lower = (upper + lower) / 2;
        state.evaluate(lat, lon, lower + ((upper - lower) * 2) / 3, low);
        this.keepBest(best, low);
      }
    }
    // Las fuentes someras son las más frecuentes: se revisan siempre
    state.evaluate(lat, lon, 10, this.extra);
    this.keepBest(best, this.extra);
    state.evaluate(lat, lon, 0, this.extra);
    this.keepBest(best, this.extra);
  }

  private keepBest(best: Prelim, candidate: Prelim): void {
    if (best.err === Number.MAX_VALUE && best.correct === 0) {
      copyPrelim(candidate, best);
      return;
    }
    if (selectBetter(best, candidate) === candidate) copyPrelim(candidate, best);
  }

  public scanArea(
    centerLat: number,
    centerLon: number,
    maxDistKm: number,
    points: number,
    depthIterations: number,
    best: Prelim
  ): void {
    const c = maxDistKm / Math.sqrt(points);
    for (let n = 0; n < points; n++) {
      const ang = (360 / (PHI * PHI)) * n;
      const dist = Math.sqrt(n) * c;
      const [lat, lon] = moveOnGlobe(centerLat, centerLon, dist, ang);
      this.bestAtPoint(lat, lon, depthIterations, best);
    }
  }
}

export interface LocateOptions {
  settings?: Partial<FinderSettings>;
  /** Hipocentro previo del grupo: la búsqueda regional se centra en él en lugar del centro de las estaciones */
  previous?: { lat: number; lon: number } | null;
}

/** Tiempo de llegada P esperado (ms) en una estación para un hipocentro */
export function expectedPArrivalMs(
  hypo: { lat: number; lon: number; depthKm: number; originMs: number },
  station: { lat: number; lon: number; elevationM: number }
): number {
  const dist = greatCircleKm(hypo.lat, hypo.lon, station.lat, station.lon);
  return hypo.originMs + (calculateTravelTime1D(dist, hypo.depthKm, 'P') + elevationCorrectionSec(station.elevationM)) * 1000;
}

/** Brecha azimutal máxima (grados) vista desde el epicentro hacia las estaciones */
export function azimuthalGapDeg(lat: number, lon: number, stations: Array<{ lat: number; lon: number }>): number {
  if (stations.length < 2) return 360;
  const az = stations.map((s) => bearingDeg(lat, lon, s.lat, s.lon)).sort((x, y) => x - y);
  let gap = 360 - az[az.length - 1] + az[0];
  for (let i = 0; i < az.length - 1; i++) gap = Math.max(gap, az[i + 1] - az[i]);
  return Math.round(gap);
}

const QUADRANTS = 26;

function quadrantScore(lat: number, lon: number, events: PickedEvent[]): number {
  const counts = new Array<number>(QUADRANTS).fill(0);
  let good = 0;
  for (const event of events) {
    const q = Math.min(QUADRANTS - 1, Math.floor((bearingDeg(lat, lon, event.lat, event.lon) * QUADRANTS) / 360));
    if (counts[q] === 0) good += 0.5;
    if (counts[q] === 1) good += 0.5;
    counts[q]++;
  }
  return good;
}

/**
 * Localiza el hipocentro de un grupo de llegadas P. Devuelve null si hay menos de 3 eventos.
 */
export function locateHypocenter(allEvents: PickedEvent[], options: LocateOptions = {}): HypocenterSolution | null {
  const settings: FinderSettings = { ...DEFAULT_FINDER_SETTINGS, ...options.settings };
  if (allEvents.length < 3) return null;

  const fixedDepth = allEvents.length < settings.freeDepthMinEvents ? settings.fixedDepthKm : null;
  const root = meanLatLon(allEvents);
  const center = options.previous ?? root;
  let farthestKm = 0;
  for (const e of allEvents) farthestKm = Math.max(farthestKm, greatCircleKm(center.lat, center.lon, e.lat, e.lon));

  const resolution = Math.max(0.2, settings.resolution);
  const runPhases = (events: PickedEvent[], regionalRadiusKm: number): Prelim | null => {
    const state = new SearchState(events, settings.pWaveInaccuracyMs);
    const searcher = new Searcher(state, settings, fixedDepth);
    const best = newPrelim();
    searcher.scanArea(center.lat, center.lon, regionalRadiusKm, Math.round(1800 * resolution), 6, best);
    if (best.correct === 0) return null;
    searcher.scanArea(best.lat, best.lon, Math.min(120, regionalRadiusKm), Math.round(900 * resolution), 8, best);
    searcher.scanArea(best.lat, best.lon, 15, Math.round(500 * resolution), 10, best);
    return best;
  };

  const regionalRadius = options.previous
    ? Math.max(150, farthestKm * 0.5)
    : Math.min(900, Math.max(250, farthestKm * 1.4 + 120));
  let selected = allEvents;
  let best = runPhases(selected, regionalRadius);
  if (!best) return null;

  // Con muchos eventos se descartan los de mayor residuo y se vuelve a buscar: afina la solución
  for (let it = 0; it < settings.reduceIterations && selected.length > settings.reduceLimit; it++) {
    const hypo = { lat: best.lat, lon: best.lon, depthKm: best.depth, originMs: best.origin };
    const residuals = selected.map((e) => ({ e, r: Math.abs(e.pWaveMs - expectedPArrivalMs(hypo, e)) }));
    residuals.sort((x, y) => x.r - y.r);
    const target = residuals.length - Math.max(1, Math.floor((residuals.length - settings.reduceLimit) * settings.reduceAmount));
    selected = residuals.slice(0, target).map((x) => x.e);
    const refined = runPhases(selected, Math.max(150, regionalRadius * 0.4));
    if (refined) best = refined;
  }

  return postProcess(allEvents, selected, best, settings, fixedDepth !== null);
}

function postProcess(
  allEvents: PickedEvent[],
  reducedEvents: PickedEvent[],
  prelim: Prelim,
  settings: FinderSettings,
  depthFixed: boolean
): HypocenterSolution {
  // Incertidumbre en profundidad: intervalo donde la heurística se mantiene dentro de 1.2 del óptimo
  const state = new SearchState(reducedEvents, settings.pWaveInaccuracyMs);
  state.setPoint(prelim.lat, prelim.lon);
  const probe = newPrelim();
  let depthUncertaintyKm = 0;
  let finalDepth = prelim.depth;
  let finalOrigin = prelim.origin;
  let fixed = depthFixed;
  if (!depthFixed) {
    const hBest = heuristic(prelim);
    let upperBound = prelim.depth;
    let lowerBound = prelim.depth;
    for (let depth = 0; depth < settings.maxDepthKm; depth += 1 / Math.max(0.2, settings.resolution)) {
      state.evaluate(prelim.lat, prelim.lon, depth, probe);
      if (heuristic(probe) > hBest / 1.2) {
        if (depth < prelim.depth && depth < upperBound) upperBound = depth;
        if (depth > prelim.depth) lowerBound = depth;
      }
    }
    depthUncertaintyKm = lowerBound - upperBound;
    // Si los datos no restringen la profundidad se usa un valor somero y se recalcula el origen
    if (depthUncertaintyKm > 200 || (depthUncertaintyKm > 20 && upperBound <= 10 && lowerBound >= 10)) {
      fixed = true;
      finalDepth = settings.fixedDepthKm;
      state.evaluate(prelim.lat, prelim.lon, finalDepth, probe);
      finalOrigin = probe.origin;
    }
  }
  if (fixed) depthUncertaintyKm = Math.max(depthUncertaintyKm, 100);

  const finalHypo = { lat: prelim.lat, lon: prelim.lon, depthKm: finalDepth, originMs: finalOrigin };
  const residualsSec: Record<string, number> = {};
  const correctKeys: string[] = [];
  let sq = 0;
  for (const e of allEvents) {
    const residualMs = e.pWaveMs - expectedPArrivalMs(finalHypo, e);
    residualsSec[e.key] = Number((residualMs / 1000).toFixed(2));
    if (Math.abs(residualMs) < settings.pWaveInaccuracyMs) {
      correctKeys.push(e.key);
      sq += (residualMs / 1000) ** 2;
    }
  }
  const rmsSec = correctKeys.length > 0 ? Math.sqrt(sq / correctKeys.length) : Infinity;

  const confidence = 1.25 * (80 / (reducedEvents.length * reducedEvents.length + 8) + 0.9);
  const region = locationConfidence(reducedEvents, prelim, settings, fixed ? settings.fixedDepthKm : null, confidence);

  const qualityOrder = Math.max(
    qualityIndex(THRESHOLDS_ORIGIN, region.originUncertaintySec, true),
    qualityIndex(THRESHOLDS_DEPTH, depthUncertaintyKm, true),
    qualityIndex(THRESHOLDS_LOCATION, region.northSouthKm, true),
    qualityIndex(THRESHOLDS_LOCATION, region.eastWestKm, true),
    qualityIndex(THRESHOLDS_STATIONS, allEvents.length, false)
  );

  return {
    lat: prelim.lat,
    lon: prelim.lon,
    depthKm: finalDepth,
    originMs: finalOrigin,
    totalErr: prelim.err,
    correctEvents: correctKeys.length,
    usedEvents: allEvents.length,
    reducedEvents: reducedEvents.length,
    correctKeys,
    residualsSec,
    rmsSec,
    depthFixed: fixed,
    depthUncertaintyKm,
    locationUncertaintyKm: region.maxKm,
    originUncertaintySec: region.originUncertaintySec,
    azimuthalGapDeg: azimuthalGapDeg(prelim.lat, prelim.lon, allEvents),
    quadrantScore: quadrantScore(prelim.lat, prelim.lon, allEvents),
    quality: QUALITY_CLASSES[qualityOrder],
  };
}

interface ConfidenceRegion {
  maxKm: number;
  northSouthKm: number;
  eastWestKm: number;
  originUncertaintySec: number;
}

const CONFIDENCE_RAYS = 16;
const CONFIDENCE_STEP_KM = 10;
const CONFIDENCE_MIN_STEP_KM = 0.5;

/**
 * Región de confianza: a lo largo de cada rayo se busca la distancia a la que la heurística del mejor hipocentro
 * en ese punto cae por debajo de la del óptimo dividida por `confidence`.
 */
function locationConfidence(
  events: PickedEvent[],
  prelim: Prelim,
  settings: FinderSettings,
  fixedDepth: number | null,
  confidence: number
): ConfidenceRegion {
  const state = new SearchState(events, settings.pWaveInaccuracyMs);
  const searcher = new Searcher(state, settings, fixedDepth);
  const optimum = newPrelim();
  searcher.bestAtPoint(prelim.lat, prelim.lon, 12, optimum);
  const hOptimum = heuristic(optimum);

  let maxKm = 0;
  let northSouthKm = 0;
  let eastWestKm = 0;
  let minOrigin = Number.POSITIVE_INFINITY;
  let maxOrigin = Number.NEGATIVE_INFINITY;
  const candidate = newPrelim();
  for (let ray = 0; ray < CONFIDENCE_RAYS; ray++) {
    const angle = (ray / CONFIDENCE_RAYS) * 360;
    let dist = CONFIDENCE_STEP_KM;
    let step = CONFIDENCE_STEP_KM;
    while (step > CONFIDENCE_MIN_STEP_KM && dist < settings.maxUncertaintySearchKm) {
      const [lat, lon] = moveOnGlobe(prelim.lat, prelim.lon, dist, angle);
      candidate.err = Number.MAX_VALUE;
      candidate.correct = 0;
      searcher.bestAtPoint(lat, lon, 12, candidate);
      if (heuristic(candidate) > hOptimum / confidence) {
        dist += step;
        minOrigin = Math.min(minOrigin, candidate.origin);
        maxOrigin = Math.max(maxOrigin, candidate.origin);
      } else {
        step /= 2;
        dist -= step;
      }
    }
    maxKm = Math.max(maxKm, dist);
    const northSouth = Math.floor((angle + 360 - 45) / 90) % 2 === 1;
    if (northSouth) northSouthKm = Math.max(northSouthKm, dist);
    else eastWestKm = Math.max(eastWestKm, dist);
  }
  const originUncertaintySec = Number.isFinite(minOrigin) ? (maxOrigin - minOrigin) / 1000 : 0;
  return { maxKm, northSouthKm, eastWestKm, originUncertaintySec };
}
