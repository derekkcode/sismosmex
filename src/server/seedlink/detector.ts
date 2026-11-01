/**
 * MOTOR SISMOLÓGICO DE DETECCIÓN, TRIANGULACIÓN DE EPICENTRO Y MAGNITUD LOCAL (ML)
 * 
 * Basado en la arquitectura secuencial de 3 etapas:
 * 1. Motor de Detección ("El Cuándo"):
 *    - STA (1.0s) / LTA (20s) en canal vertical, con umbrales calibrados por el ruido real de cada canal
 *      (noise-calibrator.ts): max(umbral base de la red, cuantil 99.5 % del ruido * margen).
 *    - El ratio y el piso de PGA base dependen de la red (IG, AM, profesionales); el calibrador los eleva
 *      en estaciones ruidosas (p. ej. Guatemala) y pone en cuarentena a los canales que disparan sin corroboración.
 *    - Coincidencia espacial: al menos 2 estaciones IG (3 en el resto, 5 en Guatemala y El Salvador)
 *      con tiempos P compatibles con su separación, dentro de una ventana de 90 s.
 * 
 * 2. Estimación del Epicentro ("El Dónde"):
 *    - Modelo de tiempos de viaje de dos capas (corteza Vp 6.1 km/s sobre manto Vp 8.04 km/s, Moho a 35 km),
 *      continuo con la profundidad, y Vs = Vp / 1.732.
 *    - Búsqueda en espiral de Vogel sobre latitud, longitud y profundidad con pérdida Pseudo-Huber;
 *      t0 por mediana robusta. Con solo 2 estaciones la solución no es única: se prefiere la más cercana a la
 *      estación más temprana y el evento nunca se confirma solo.
 *    - Geocodificación inversa hacia la localidad más cercana de México y Centroamérica.
 * 
 * 3. Estimación de Magnitud ("El Qué tan fuerte"):
 *    - Relación PGA-distancia hipocentral invertida por estación; mediana de estaciones como magnitud oficial.
 * 
 * 4. Confirmación y persistencia:
 *    - Un evento se confirma solo con evidencia: >= 3 estaciones coherentes, onda S observada en >= 2
 *      estaciones, o 2 estaciones muy por encima de su piso con PGA >= 0.20 gal. Si no se confirma en 60 s se retira.
 *    - Guarda automáticamente los sismos en data/earthquakes.json.
 */

import fs from 'fs';
import path from 'path';
import { USGSEarthquakeService } from './usgs-service.js';
import { NoiseCalibrator, NoiseClass } from './noise-calibrator.js';
import {
  SeismicDspEngine,
  pgaToContinuousMmi,
  pgaToMercalli,
  isRaspberryShake,
  isProfessionalNetwork,
  isMexicanIGNetwork,
  isGuatemalaStation,
  isGuatemalaNetwork,
  isElSalvadorStation,
  isElSalvadorNetwork,
  isChiapasStation,
  PROFESSIONAL_NETWORKS,
  DEFAULT_STA_LTA_CONFIG
} from './seismic-dsp.js';

export {
  PROFESSIONAL_NETWORKS,
  isMexicanIGNetwork,
  isGuatemalaStation,
  isGuatemalaNetwork,
  isElSalvadorStation,
  isElSalvadorNetwork,
  isChiapasStation
};

export interface StationTriggerRecord {
  station: string;
  network: string;
  channel: string;
  lat: number;
  lon: number;
  site: string;
  stateName: string;
  tP: number; // Timestamp en ms
  tP_iso: string;
  receivedWallTime?: number; // Timestamp de llegada al servidor (ms)
  tS?: number; // Timestamp de onda S en ms
  tS_iso?: string;
  sWaveExpectedMs?: number; // Hora esperada de arribo de onda S en ms (GlobalQuake)
  sWaveCountdownSec?: number; // Segundos restantes para el impacto de la onda S
  sWaveArrived?: boolean; // True si la onda S ya impactó físicamente la estación
  distanceKm?: number; // Distancia calculada D
  staLtaRatio: number;
  maxPga: number;
  maxAmp: number;
  woodAndersonAmpMm?: number; // Amplitud sintetizada Wood-Anderson (mm)
  stationML?: number;
  isPureFrequency?: boolean; // True si la energía está en la banda 4 - 10 Hz
  freqDominantHz?: number;
  highFreqRatio?: number;
  reqRatio?: number; // Umbral STA/LTA base de la red con el que se abrió el disparo
  reqPga?: number; // Piso de PGA base de la red con el que se abrió el disparo
  noiseClass?: NoiseClass; // Clasificación de ruido del canal al abrir el disparo
  lastUpdateWallTime?: number; // Último paquete que alimentó este disparo (ms)
  eventId?: string; // Sismo al que está asociado el disparo
  corroborated?: boolean; // True si el disparo formó parte de un sismo confirmado
  rejected?: boolean; // True si el evento al que pertenecía se retiró sin evidencia: no vuelve a formar otro
  pPhasePga?: number; // Pico de PGA antes de la llegada esperada de la onda S
  sPhasePga?: number; // Pico de PGA a partir de la llegada esperada de la onda S
}

export function generateDisplayId(id?: string): string {
  if (!id) return '';
  const parts = id.split('-');
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.length >= 3 && lastPart.length <= 6) {
    return lastPart.toUpperCase();
  }
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'EQ';
}

export interface DetectedEarthquake {
  id: string;
  displayId?: string; // ID corto y sutil (ej: 8F3A)
  time: string; // t0 Tiempo de origen (ISO)
  timeEpoch: number; // t0 en ms
  detectedAt: string; // Momento de la declaración de alerta
  latitude: number;
  longitude: number;
  depth: number; // Profundidad estimada en km
  magnitude: number; // Magnitud oficial ML
  magnitudeType: string;
  location: string; // Ej: "24 km al Suroeste de Pinotepa Nacional, Oax"
  maxPga: number; // gal
  maxIntensity: number; // Mercalli (MMI 1 - 10)
  stationCount: number;
  stations: StationTriggerRecord[];
  status: 'PRELIMINARY' | 'CONFIRMED';
  source: string;
  isMicro?: boolean;
  isAlert?: boolean;
  isInter?: boolean;
  category?: string;
  saved?: boolean;
  reportNumber?: number;
  // Métricas avanzadas de GlobalQuake (v0.11.0)
  azimuthalGap?: number; // Brecha azimutal máxima en grados (0 - 360)
  rmsResidualSec?: number; // Residuo medio cuadrático de tiempos de viaje (s)
  clusterLevel?: number; // Nivel de escalada de cluster sísmico (1, 2, 3)
  sWaveArrivedCount?: number; // Estaciones que ya registraron el paso de la onda S
  isSWaveConfirmed?: boolean; // True si la onda S ya corroboró la magnitud física
}

// =========================================================================
// FUNCIONES AUXILIARES GLOBALES: ALGORITMO SUNFLOWER Y CALIDAD (GLOBALQUAKE 0.11.0)
// =========================================================================

/**
 * Ángulo áureo (Golden Angle) para la distribución uniforme en espiral de Vogel (Sunflower)
 * Utilizado en GlobalQuake para eliminar sesgos de grilla rectangular y asegurar
 * una densidad espacial perfectamente isótropa sobre la superficie esférica.
 */
const GOLDEN_ANGLE = Math.PI * (3.0 - Math.sqrt(5.0)); // ~2.39996322972865332 rad (~137.50776°)

/**
 * Genera puntos de búsqueda hipocentral distribuidos uniformemente mediante
 * el algoritmo Sunflower de Vogel (GlobalQuake 0.11.0).
 */
export function getSunflowerPoints(
  centerLat: number,
  centerLon: number,
  maxRadiusKm: number,
  pointCount: number
): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = [];
  const cosLat = Math.cos((centerLat * Math.PI) / 180.0);
  const kmPerDegLat = 111.195;
  const kmPerDegLon = 111.195 * (Math.abs(cosLat) > 0.05 ? cosLat : 1.0);

  for (let i = 0; i < pointCount; i++) {
    // r proporcional a sqrt(i / pointCount) asegura densidad espacial de área constante
    const rKm = maxRadiusKm * Math.sqrt((i + 0.5) / pointCount);
    const theta = i * GOLDEN_ANGLE;
    const dLat = (rKm * Math.cos(theta)) / kmPerDegLat;
    const dLon = (rKm * Math.sin(theta)) / kmPerDegLon;
    points.push({
      lat: Number((centerLat + dLat).toFixed(4)),
      lon: Number((centerLon + dLon).toFixed(4)),
    });
  }
  return points;
}

/**
 * Calcula la brecha azimutal (Azimuthal Gap) hacia las estaciones detectadas (GlobalQuake 0.11.0).
 * Representa el mayor ángulo vacío sin estaciones alrededor del epicentro.
 */
export function calculateAzimuthalGap(
  epiLat: number,
  epiLon: number,
  stations: Array<{ lat: number; lon: number }>
): number {
  if (stations.length < 2) return 360;
  const rad = Math.PI / 180.0;
  const phi1 = epiLat * rad;
  const lam1 = epiLon * rad;

  const azimuths: number[] = stations.map((st) => {
    const phi2 = st.lat * rad;
    const lam2 = st.lon * rad;
    const y = Math.sin(lam2 - lam1) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lam2 - lam1);
    let deg = Math.atan2(y, x) * (180.0 / Math.PI);
    if (deg < 0) deg += 360.0;
    return deg;
  });

  azimuths.sort((a, b) => a - b);
  let maxGap = 360.0 - azimuths[azimuths.length - 1] + azimuths[0];
  for (let i = 0; i < azimuths.length - 1; i++) {
    const gap = azimuths[i + 1] - azimuths[i];
    if (gap > maxGap) maxGap = gap;
  }
  return Math.round(maxGap);
}

/**
 * Función de pérdida Pseudo-Huber robusta (GlobalQuake 0.11.0)
 * L2 suave cerca de cero (|r| <= delta), L1 asintótico para valores atípicos (|r| > delta).
 */
export function pseudoHuberLoss(residualSec: number, delta: number = 1.0): number {
  const rOverDelta = residualSec / delta;
  return 2.0 * delta * delta * (Math.sqrt(1.0 + rOverDelta * rOverDelta) - 1.0);
}

/**
 * Calcula la mediana estadística de un arreglo numérico
 */
export function computeMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0;
}

/**
 * Geometría degenerada: con pocas estaciones concentradas en un solo lado del epicentro
 * (brecha azimutal > 270°) el hipocentro queda mal restringido y la localización no es confiable.
 */
export function isDegenerateGeometry(azimuthalGap: number | undefined, stationCount: number): boolean {
  return azimuthalGap !== undefined && azimuthalGap > 270 && stationCount < 5;
}

/** Simplex de Nelder-Mead: minimiza f sin derivadas; se usa para pulir el hipocentro fuera de la rejilla */
function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], maxIter: number): { x: number[]; fx: number } {
  const n = x0.length;
  const pts: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += steps[i];
    pts.push(p);
  }
  let vals = pts.map(f);

  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const sortedPts = order.map((i) => pts[i]);
    const sortedVals = order.map((i) => vals[i]);
    for (let i = 0; i <= n; i++) {
      pts[i] = sortedPts[i];
      vals[i] = sortedVals[i];
    }
    if (vals[n] - vals[0] < 1e-5) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += pts[i][j] / n;
    const along = (t: number) => centroid.map((c, j) => c + t * (pts[n][j] - c));

    const xr = along(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = along(-2);
      const fe = f(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      pts[n] = xr;
      vals[n] = fr;
    } else {
      const xc = along(fr < vals[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) {
        pts[n] = xc;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = f(pts[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (vals[i] < vals[best]) best = i;
  return { x: pts[best], fx: vals[best] };
}

/**
 * Constantes geofísicas del modelo regional de tiempos de viaje de dos capas (corteza sobre manto superior)
 */
export const EARTH_RADIUS_KM = 6371.0;
export const MOHO_DEPTH_KM = 35.0;
export const VP_VS_RATIO = 1.732; // Relación de Poisson elástica teórica de Wadati para ondas P y S
const VP_CRUST_KMS = 6.1;
const VP_MANTLE_KMS = 8.04;

// Rejilla de tiempos de viaje precalculada: la búsqueda de epicentro evalúa decenas de miles de hipótesis por llamada
const TT_MAX_DIST_KM = 1500;
const TT_DIST_STEP_KM = 2;
const TT_MAX_DEPTH_KM = 300;
const TT_DEPTH_STEP_KM = 3;
const TT_DEPTH_COUNT = Math.floor(TT_MAX_DEPTH_KM / TT_DEPTH_STEP_KM) + 1;
let travelTimeTableP: Float32Array | null = null;

/**
 * Tiempo de viaje P exacto en un modelo plano de dos capas (corteza Vc sobre manto Vm, Moho a MOHO_DEPTH_KM).
 * - Fuente cortical: el menor entre la onda directa y la refractada en el Moho (Pn).
 * - Fuente en el manto: rayo ascendente que cruza el Moho por Snell, resuelto por bisección en el ángulo de salida.
 * Es continuo al cruzar el Moho (el modelo previo saltaba ~20 % a 35 km y sesgaba profundidad y t0).
 */
function exactTravelTimeP(distKm: number, depthKm: number): number {
  const H = MOHO_DEPTH_KM;
  const vc = VP_CRUST_KMS;
  const vm = VP_MANTLE_KMS;
  const k = vc / vm;
  const cosCrit = Math.sqrt(1 - k * k);

  // Una fuente a menos de 0.5 km bajo el Moho se trata como fuente en el Moho (evita la degeneración numérica)
  if (depthKm <= H + 0.5) {
    const h = Math.min(depthKm, H);
    const direct = Math.hypot(distKm, h) / vc;
    const critDistKm = ((2 * H - h) * k) / cosCrit;
    if (distKm < critDistKm) return direct;
    const headWave = distKm / vm + ((2 * H - h) * cosCrit) / vc;
    return Math.min(direct, headWave);
  }

  const mantleLegKm = depthKm - H;
  let lo = 0;
  let hi = 1 - 1e-12;
  for (let it = 0; it < 60; it++) {
    const u = 0.5 * (lo + hi);
    const x = (mantleLegKm * u) / Math.sqrt(1 - u * u) + (H * u * k) / Math.sqrt(1 - u * u * k * k);
    if (x < distKm) lo = u;
    else hi = u;
  }
  const u = 0.5 * (lo + hi);
  return mantleLegKm / (vm * Math.sqrt(1 - u * u)) + H / (vc * Math.sqrt(1 - u * u * k * k));
}

function buildTravelTimeTable(): Float32Array {
  const distCount = Math.floor(TT_MAX_DIST_KM / TT_DIST_STEP_KM) + 1;
  const table = new Float32Array(distCount * TT_DEPTH_COUNT);
  for (let i = 0; i < distCount; i++) {
    for (let j = 0; j < TT_DEPTH_COUNT; j++) {
      table[i * TT_DEPTH_COUNT + j] = exactTravelTimeP(Math.max(0.05, i * TT_DIST_STEP_KM), Math.max(0.5, j * TT_DEPTH_STEP_KM));
    }
  }
  return table;
}

/**
 * Modelo de tiempos de viaje regional continuo (Pg / Pn para fuentes corticales y rayo refractado para fuentes del manto).
 *
 * @param distSurfaceKm Distancia epicentral sobre la superficie terrestre (km)
 * @param depthKm Profundidad focal del sismo (km)
 * @param phase 'P' para onda primaria, 'S' para onda secundaria
 * @returns Tiempo de viaje teórico en segundos
 */
export function calculateTravelTime1D(
  distSurfaceKm: number,
  depthKm: number,
  phase: 'P' | 'S' = 'P'
): number {
  const d = Math.max(0.1, distSurfaceKm);
  const h = Math.max(1.0, Math.min(650.0, depthKm));

  let ttP: number;
  if (d >= TT_MAX_DIST_KM || h >= TT_MAX_DEPTH_KM) {
    ttP = exactTravelTimeP(d, h);
  } else {
    if (!travelTimeTableP) travelTimeTableP = buildTravelTimeTable();
    const fd = d / TT_DIST_STEP_KM;
    const fh = h / TT_DEPTH_STEP_KM;
    const i0 = Math.floor(fd);
    const j0 = Math.floor(fh);
    const wd = fd - i0;
    const wh = fh - j0;
    const base = i0 * TT_DEPTH_COUNT + j0;
    const t = travelTimeTableP;
    ttP = (t[base] * (1 - wh) + t[base + 1] * wh) * (1 - wd) +
      (t[base + TT_DEPTH_COUNT] * (1 - wh) + t[base + TT_DEPTH_COUNT + 1] * wh) * wd;
  }

  return phase === 'S' ? ttP * VP_VS_RATIO : ttP;
}

export function calculateClusterLevel(
  stationCount: number,
  maxPga: number = 0,
  isConfirmed: boolean = false
): number {
  if (isConfirmed || stationCount >= 5) {
    return 3;
  }
  if (stationCount >= 3 || (stationCount >= 2 && maxPga >= 0.20)) {
    return 2;
  }
  return 1;
}

export class SeismicDetectorEngine {
  private static instance: SeismicDetectorEngine;
  private earthquakesFile: string;
  private earthquakes: DetectedEarthquake[] = [];

  // Búfer de disparos activos para coincidencia cinemática (ventana amplia regional de 90s para absorber latencias de red)
  private activeTriggers: Map<string, StationTriggerRecord> = new Map();
  private triggerWindowMs: number = 90000; // 90s para acomodar retraso de SeedLink de estaciones con latencia (como MMIG ~56s)
  private minStationsForEvent: number = 2; // Mínimo 2 estaciones para red IG mexicana fuera de Chiapas

  // Ventana de seguimiento de amplitud máxima (60-90s post-disparo) para capturar la onda S (Item 21)
  private amplitudeTrackingMap: Map<string, {
    tP: number;
    maxPga: number;
    maxAmp: number;
    woodAndersonAmpMm: number;
    lastUpdateMs: number;
  }> = new Map();
  private readonly amplitudeTrackingWindowMs: number = 90000; // 90 segundos

  // Estado de sismos en curso para permitir procesar hasta 2 sismos simultáneos independientes
  private lastDeclaredEventTime: number = 0;
  private eventCooldownMs: number = 35000; // 35 segundos de enfriamiento para el mismo epicentro/región
  private activePreliminaryIds: Set<string> = new Set();

  // Callback para emitir evento detectado a WebSocket
  private onEventDetectedCallback: ((event: DetectedEarthquake) => void) | null = null;
  // Callback cuando un evento preliminar se retira por falta de evidencia
  private onEventCancelledCallback: ((event: DetectedEarthquake, reason: string) => void) | null = null;

  // Calibrador de ruido por canal: recibe la retroalimentación de disparos corroborados y falsos
  private readonly noise: NoiseCalibrator = NoiseCalibrator.getInstance();
  private readonly preliminaryExpiryMs: number = 60000; // Un preliminar sin evidencia en 60 s se retira
  private readonly staleOnsetMs: number = 30000; // Un onset más viejo que esto ya no abre un disparo nuevo
  private readonly evaluationMinIntervalMs: number = 400;
  private lastEvaluationMs: number = 0;
  private lastDiagSignature: string = '';
  private evaluationTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  // Actividad reciente por canal vertical para que cada estación abra disparos con un solo canal
  private channelActivity: Map<string, Map<string, number>> = new Map();

  // Localidades y puntos de referencia sísmica en la República Mexicana
  private static readonly REFERENCE_CITIES: Array<{ name: string; state: string; lat: number; lon: number }> = [
    { name: 'Acapulco', state: 'Guerrero', lat: 16.85, lon: -99.90 },
    { name: 'Ometepec', state: 'Guerrero', lat: 16.68, lon: -98.40 },
    { name: 'Coyuca de Benítez', state: 'Guerrero', lat: 17.01, lon: -100.08 },
    { name: 'San Marcos', state: 'Guerrero', lat: 16.79, lon: -99.39 },
    { name: 'Zihuatanejo', state: 'Guerrero', lat: 17.64, lon: -101.55 },
    { name: 'Petatlán', state: 'Guerrero', lat: 17.53, lon: -101.27 },
    { name: 'Chilpancingo', state: 'Guerrero', lat: 17.55, lon: -99.50 },
    { name: 'Pinotepa Nacional', state: 'Oaxaca', lat: 16.34, lon: -98.05 },
    { name: 'Puerto Escondido', state: 'Oaxaca', lat: 15.86, lon: -97.07 },
    { name: 'Huatulco', state: 'Oaxaca', lat: 15.76, lon: -96.13 },
    { name: 'Salina Cruz', state: 'Oaxaca', lat: 16.18, lon: -95.20 },
    { name: 'Matías Romero', state: 'Oaxaca', lat: 16.87, lon: -95.04 },
    { name: 'Oaxaca de Juárez', state: 'Oaxaca', lat: 17.06, lon: -96.72 },
    { name: 'Miahuatlán', state: 'Oaxaca', lat: 16.33, lon: -96.59 },
    { name: 'Tonalá', state: 'Chiapas', lat: 16.09, lon: -93.75 },
    { name: 'Pijijiapan', state: 'Chiapas', lat: 15.69, lon: -93.21 },
    { name: 'Mapastepec', state: 'Chiapas', lat: 15.43, lon: -92.90 },
    { name: 'Ciudad Hidalgo', state: 'Chiapas', lat: 14.68, lon: -92.15 },
    { name: 'Tuxtla Gutiérrez', state: 'Chiapas', lat: 16.75, lon: -93.11 },
    { name: 'Coalcomán', state: 'Michoacán', lat: 18.78, lon: -103.16 },
    { name: 'Aquila', state: 'Michoacán', lat: 18.60, lon: -103.50 },
    { name: 'Lázaro Cárdenas', state: 'Michoacán', lat: 17.96, lon: -102.20 },
    { name: 'Playa Azul', state: 'Michoacán', lat: 17.98, lon: -102.35 },
    { name: 'Tecomán', state: 'Colima', lat: 18.91, lon: -103.87 },
    { name: 'Manzanillo', state: 'Colima', lat: 19.05, lon: -104.31 },
    { name: 'Colima', state: 'Colima', lat: 19.24, lon: -103.72 },
    { name: 'Cihuatlán', state: 'Jalisco', lat: 19.23, lon: -104.57 },
    { name: 'Puerto Vallarta', state: 'Jalisco', lat: 20.65, lon: -105.23 },
    { name: 'Autlán de Navarro', state: 'Jalisco', lat: 19.77, lon: -104.36 },
    { name: 'Chiautla de Tapia', state: 'Puebla', lat: 18.30, lon: -98.60 },
    { name: 'Izúcar de Matamoros', state: 'Puebla', lat: 18.60, lon: -98.47 },
    { name: 'Puebla', state: 'Puebla', lat: 19.04, lon: -98.20 },
    { name: 'Cuernavaca', state: 'Morelos', lat: 18.92, lon: -99.23 },
    { name: 'Ciudad de México', state: 'Ciudad de México', lat: 19.43, lon: -99.13 },
    { name: 'Toluca', state: 'Estado de México', lat: 19.29, lon: -99.65 },
    { name: 'Coatzacoalcos', state: 'Veracruz', lat: 18.15, lon: -94.45 },
    { name: 'Veracruz', state: 'Veracruz', lat: 19.18, lon: -96.14 },
    { name: 'Loreto', state: 'Baja California Sur', lat: 26.01, lon: -111.35 },
    { name: 'Santa Rosalía', state: 'Baja California Sur', lat: 27.34, lon: -112.26 },
    { name: 'Mexicali', state: 'Baja California', lat: 32.65, lon: -115.46 },
    // Localidades y Puntos de Referencia en Guatemala (Red INSIVUMEH)
    { name: 'Ciudad de Guatemala', state: 'Guatemala', lat: 14.63, lon: -90.51 },
    { name: 'Quetzaltenango', state: 'Quetzaltenango, Guatemala', lat: 14.83, lon: -91.52 },
    { name: 'Huehuetenango', state: 'Huehuetenango, Guatemala', lat: 15.32, lon: -91.47 },
    { name: 'San Marcos', state: 'San Marcos, Guatemala', lat: 14.96, lon: -91.80 },
    { name: 'Retalhuleu', state: 'Retalhuleu, Guatemala', lat: 14.53, lon: -91.68 },
    { name: 'Escuintla', state: 'Escuintla, Guatemala', lat: 14.30, lon: -90.79 },
    { name: 'Cobán', state: 'Alta Verapaz, Guatemala', lat: 15.47, lon: -90.37 },
    { name: 'Puerto Barrios', state: 'Izabal, Guatemala', lat: 15.73, lon: -88.60 },
    { name: 'Flores', state: 'Petén, Guatemala', lat: 16.92, lon: -89.89 },
    // Localidades y Puntos de Referencia en El Salvador (Red MARN / SNET)
    { name: 'San Salvador', state: 'San Salvador, El Salvador', lat: 13.69, lon: -89.19 },
    { name: 'Santa Ana', state: 'Santa Ana, El Salvador', lat: 13.99, lon: -89.55 },
    { name: 'San Miguel', state: 'San Miguel, El Salvador', lat: 13.48, lon: -88.18 },
    { name: 'Usulután', state: 'Usulután, El Salvador', lat: 13.35, lon: -88.45 },
    { name: 'Ahuachapán', state: 'Ahuachapán, El Salvador', lat: 13.92, lon: -89.84 },
    { name: 'Sonsonate', state: 'Sonsonate, El Salvador', lat: 13.72, lon: -89.72 },
    { name: 'La Unión', state: 'La Unión, El Salvador', lat: 13.33, lon: -87.84 },
    { name: 'Chalatenango', state: 'Chalatenango, El Salvador', lat: 14.04, lon: -88.93 },
    { name: 'San Vicente', state: 'San Vicente, El Salvador', lat: 13.64, lon: -88.78 },
    // Localidades y Puntos de Referencia en Honduras (Red COPECO / UNAH)
    { name: 'Tegucigalpa', state: 'Francisco Morazán, Honduras', lat: 14.08, lon: -87.21 },
    { name: 'San Pedro Sula', state: 'Cortés, Honduras', lat: 15.50, lon: -88.02 },
    { name: 'La Ceiba', state: 'Atlántida, Honduras', lat: 15.78, lon: -86.79 },
    { name: 'Comayagua', state: 'Comayagua, Honduras', lat: 14.45, lon: -87.64 },
    { name: 'Choluteca', state: 'Choluteca, Honduras', lat: 13.30, lon: -87.19 },
    { name: 'Roatán', state: 'Islas de la Bahía, Honduras', lat: 16.32, lon: -86.53 },
    { name: 'Santa Bárbara', state: 'Santa Bárbara, Honduras', lat: 14.92, lon: -88.24 },
    { name: 'Copán Ruinas', state: 'Copán, Honduras', lat: 14.84, lon: -89.16 },
    { name: 'Juticalpa', state: 'Olancho, Honduras', lat: 14.66, lon: -86.22 },
    { name: 'Nacaome', state: 'Valle, Honduras', lat: 13.53, lon: -87.49 },
    { name: 'Trujillo', state: 'Colón, Honduras', lat: 15.92, lon: -85.95 },
  ];

  private constructor() {
    this.earthquakesFile = path.join(process.cwd(), 'data', 'earthquakes.json');
    this.loadEarthquakesFromDisk();

    // Sincronizar sismos de países de América >= 5.5 desde USGS (inmediato y cada 4 minutos)
    setTimeout(() => this.syncUSGSEarthquakes(), 2500);
    setInterval(() => this.syncUSGSEarthquakes(), 4 * 60 * 1000);

    // Limpieza periódica de disparos obsoletos que excedan la ventana de coincidencia
    setInterval(() => this.pruneStaleTriggers(), 3000);
  }

  public async syncUSGSEarthquakes(): Promise<void> {
    try {
      const usgsEvents = await USGSEarthquakeService.getInstance().fetchRecentAmericanEarthquakes(5.5);
      if (usgsEvents && usgsEvents.length > 0) {
        this.earthquakes = this.deduplicateEarthquakes([...this.earthquakes, ...usgsEvents]);
        this.saveEarthquakesToDisk();
      }
    } catch (e) {
      console.warn('[Detector] Error sincronizando sismos USGS:', (e as Error).message);
    }
  }

  public static getInstance(): SeismicDetectorEngine {
    if (!SeismicDetectorEngine.instance) {
      SeismicDetectorEngine.instance = new SeismicDetectorEngine();
    }
    return SeismicDetectorEngine.instance;
  }

  public setOnEventDetected(cb: (event: DetectedEarthquake) => void): void {
    this.onEventDetectedCallback = cb;
  }

  public setOnEventCancelled(cb: (event: DetectedEarthquake, reason: string) => void): void {
    this.onEventCancelledCallback = cb;
  }

  private streamKeyOf(t: { network: string; station: string; channel: string }): string {
    return NoiseCalibrator.streamKey(t.network, t.station, t.channel);
  }

  /** Prioridad de canal para detectar: banda ancha de alta tasa antes que BH y que los acelerómetros */
  private static channelPriority(channel: string): number {
    const c = (channel || '').toUpperCase();
    if (c.startsWith('HH')) return 100;
    if (c.startsWith('EH')) return 95;
    if (c.startsWith('SH')) return 90;
    if (c.startsWith('BH')) return 80;
    if (c.length >= 2 && c[1] === 'N') return 60;
    return 50;
  }

  private noteChannelActivity(station: string, channel: string, nowMs: number): void {
    let chans = this.channelActivity.get(station);
    if (!chans) {
      chans = new Map();
      this.channelActivity.set(station, chans);
    }
    chans.set(channel.toUpperCase(), nowMs);
  }

  /**
   * SeedLink entrega todos los canales verticales de una estación (HHZ, HNZ, BHZ). Solo el mejor canal activo
   * puede abrir un disparo; los demás solo aportan picos de amplitud y no duplican ni contaminan el disparo.
   */
  private isPreferredDetectionChannel(station: string, channel: string, nowMs: number): boolean {
    const chans = this.channelActivity.get(station);
    if (!chans) return true;
    const mine = channel.toUpperCase();
    const myPriority = SeismicDetectorEngine.channelPriority(mine);
    for (const [other, seenMs] of chans) {
      if (other === mine || nowMs - seenMs > 30000) continue;
      if (SeismicDetectorEngine.channelPriority(other) > myPriority) return false;
    }
    return true;
  }

  /** Agrupa las escrituras de disco por actualización de amplitud en una cada 2 s */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveEarthquakesToDisk();
    }, 2000);
  }

  /** Limita la búsqueda de epicentro a unas pocas ejecuciones por segundo, sin perder la última solicitud */
  private requestEvaluation(): void {
    const now = Date.now();
    const wait = this.lastEvaluationMs + this.evaluationMinIntervalMs - now;
    if (wait <= 0) {
      this.lastEvaluationMs = now;
      this.evaluateSpatialCoincidence();
    } else if (!this.evaluationTimer) {
      this.evaluationTimer = setTimeout(() => {
        this.evaluationTimer = null;
        this.lastEvaluationMs = Date.now();
        this.evaluateSpatialCoincidence();
      }, wait);
    }
  }

  /** Pico de PGA antes y después de la llegada esperada de la onda S (evidencia observada, no predicha) */
  private trackPhasePeaks(tr: StationTriggerRecord, pga: number, packetStartMs: number): void {
    if (tr.sWaveExpectedMs !== undefined && packetStartMs >= tr.sWaveExpectedMs - 1000) {
      if (pga > (tr.sPhasePga ?? 0)) tr.sPhasePga = pga;
    } else if (pga > (tr.pPhasePga ?? 0)) {
      tr.pPhasePga = pga;
    }
  }

  private triggerRequirements(t: StationTriggerRecord): { minRatio: number; minPga: number } {
    return {
      minRatio: t.reqRatio ?? DEFAULT_STA_LTA_CONFIG.thresholdStandard,
      minPga: t.reqPga ?? DEFAULT_STA_LTA_CONFIG.minPgaStandard,
    };
  }

  /**
   * Un evento solo se confirma con evidencia física: red coherente de >= 3 estaciones, onda S observada en >= 2
   * estaciones, o 2 estaciones muy por encima de su propio piso con PGA >= 0.20 gal. El paso del tiempo no confirma nada.
   */
  private evaluateConfirmation(stations: StationTriggerRecord[], maxPga: number, sWaveConfirmed: boolean): boolean {
    if (stations.length >= 3 || sWaveConfirmed) return true;
    const strong = stations.filter((s) => s.maxPga >= 3 * (s.reqPga ?? 0.1)).length;
    return stations.length >= 2 && strong >= 2 && maxPga >= 0.20;
  }

  /** Asocia los disparos al evento y, si está confirmado, premia a sus canales en el calibrador de ruido */
  private markEventStations(event: DetectedEarthquake): void {
    const confirmed = event.status === 'CONFIRMED';
    const now = Date.now();
    for (const st of event.stations) {
      st.eventId = event.id;
      if (confirmed && !st.corroborated) {
        st.corroborated = true;
        this.noise.reportCorroboratedTrigger(this.streamKeyOf(st), now);
      }
    }
  }

  /** Retira los eventos preliminares que no lograron evidencia suficiente y penaliza a sus canales */
  private expireUnconfirmedEvents(now: number): void {
    const expired = this.earthquakes.filter((e) => {
      if (e.status !== 'PRELIMINARY' || (e as any).isLocked) return false;
      const detectedMs = new Date(e.detectedAt).getTime();
      return Number.isFinite(detectedMs) && now - detectedMs > this.preliminaryExpiryMs;
    });
    if (expired.length === 0) return;

    const ids = new Set(expired.map((e) => e.id));
    this.earthquakes = this.earthquakes.filter((e) => !ids.has(e.id));
    for (const e of expired) {
      this.activePreliminaryIds.delete(e.id);
      for (const st of e.stations || []) {
        st.rejected = true;
        if (!st.corroborated) this.noise.reportFalseTrigger(this.streamKeyOf(st), now);
      }
      console.log(`[Detector] Evento preliminar ${e.id} retirado: sin evidencia suficiente tras ${this.preliminaryExpiryMs / 1000}s (${e.stationCount} estaciones, M ${e.magnitude}).`);
      if (this.onEventCancelledCallback) {
        this.onEventCancelledCallback(e, 'unconfirmed_expired');
      }
    }
    this.saveEarthquakesToDisk();
  }

  /**
   * Carga o inicializa el archivo local data/earthquakes.json
   */
  public deduplicateEarthquakes(list: DetectedEarthquake[]): DetectedEarthquake[] {
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
        result[matchIdx] = {
          ...existing,
          ...eq,
          magnitude: Math.max(existing.magnitude || 0, eq.magnitude || 0),
          maxPga: Math.max(existing.maxPga || 0, eq.maxPga || 0),
          maxIntensity: Math.max(existing.maxIntensity || 1, eq.maxIntensity || 1),
          stationCount: Math.max(existing.stationCount || 0, eq.stationCount || 0, (existing.stations || []).length, (eq.stations || []).length),
          reportNumber: Math.max((existing as any).reportNumber || 1, (eq as any).reportNumber || 1),
          status: (existing.status === 'CONFIRMED' || eq.status === 'CONFIRMED') ? 'CONFIRMED' : 'PRELIMINARY',
          saved: true,
        };
      } else {
        result.push(eq);
      }
    }
    return result;
  }

  private loadEarthquakesFromDisk(): void {
    try {
      const dataDir = path.dirname(this.earthquakesFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      let targetFile = this.earthquakesFile;
      if (!fs.existsSync(targetFile)) {
        const altFile = path.join(process.cwd(), 'data', 'earthquake.json');
        if (fs.existsSync(altFile)) {
          targetFile = altFile;
        }
      }

      if (fs.existsSync(targetFile)) {
        const content = fs.readFileSync(targetFile, 'utf8');
        const parsed = JSON.parse(content || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
          const raw = parsed.filter(eq => eq && (eq.id || eq.location));
          this.earthquakes = this.deduplicateEarthquakes(raw);
        }

        // Marcar eventos cargados desde disco como guardados y confirmados
        this.earthquakes.forEach((eq) => {
          eq.saved = true;
          if (eq.status === 'PRELIMINARY' || (eq as any).active) {
            eq.status = 'CONFIRMED';
            (eq as any).active = false;
            (eq as any).isLocked = true;
          }
        });

        this.saveEarthquakesToDisk();
        console.log(`[Detector] Cargados ${this.earthquakes.length} eventos sísmicos únicos desde ${targetFile}`);
      } else {
        this.earthquakes = [];
      }
    } catch (err) {
      console.error('[Detector] Error accediendo a data/earthquakes.json:', err);
      this.earthquakes = [];
    }
  }

  private saveEarthquakesToDisk(): void {
    try {
      const dataDir = path.dirname(this.earthquakesFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.earthquakes = this.deduplicateEarthquakes(this.earthquakes);
      const tmpFile = `${this.earthquakesFile}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.earthquakes, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.earthquakesFile);

      const altFile = path.join(process.cwd(), 'data', 'earthquake.json');
      try {
        fs.writeFileSync(altFile, JSON.stringify(this.earthquakes, null, 2), 'utf8');
      } catch (_) {}
    } catch (err) {
      console.error('[Detector] Error escribiendo en data/earthquakes.json:', err);
    }
  }

  /**
   * Elimina disparos que hayan quedado fuera de la ventana de coincidencia temporal.
   * Un disparo aislado (sin sismo asociado ni coincidencia con otra estación) es la firma del ruido y
   * cuenta como falso para la calibración de su canal.
   */
  private pruneStaleTriggers(): void {
    const now = Date.now();
    const snapshot = Array.from(this.activeTriggers.values());
    for (const trigger of snapshot) {
      const wallAgeMs = now - (trigger.receivedWallTime || now);
      if (wallAgeMs <= this.triggerWindowMs) continue;

      this.activeTriggers.delete(trigger.station);
      if (!trigger.corroborated && !trigger.eventId && !this.hasCoincidentTrigger(trigger, snapshot)) {
        this.noise.reportFalseTrigger(this.streamKeyOf(trigger), now);
      }
    }
    this.expireUnconfirmedEvents(now);
  }

  /** Otra estación cercana disparó casi a la vez: la sacudida es real aunque la red no alcance para declarar */
  private hasCoincidentTrigger(trigger: StationTriggerRecord, all: StationTriggerRecord[]): boolean {
    return all.some((other) =>
      other.station !== trigger.station &&
      Math.abs(other.tP - trigger.tP) <= 20000 &&
      this.haversineDistanceKm(trigger.lat, trigger.lon, other.lat, other.lon) <= 300.0
    );
  }

  // =========================================================================
  // ETAPA 1: ALGORITMO DE DETECCIÓN (EL "CUÁNDO")
  // =========================================================================

  /**
   * Recibe el resultado DSP de cada paquete de MiniSEED procesado por el servidor
   */
  public processStationTelemetry(params: {
    station: string;
    network: string;
    channel: string;
    lat: number;
    lon: number;
    site: string;
    stateName: string;
    pga: number;
    amp: number;
    staLtaRatio: number;
    sampleRate: number;
    packetStartTime: string;
    isPureFrequencySeismic?: boolean;
    freqDominantHz?: number;
    highFreqRatio?: number;
    triggered?: boolean;
    triggerSampleIndex?: number | null;
    triggerTimeIso?: string | null;
    refinedPickIso?: string | null; // Llegada P refinada con AIC (dentro de la ventana del cruce STA/LTA)
    woodAndersonDispMm?: number;
    minPgaThreshold?: number; // Piso de PGA calibrado del canal (ruido real * margen)
    noiseClass?: NoiseClass;
  }): void {
    const {
      station,
      network,
      channel,
      lat,
      lon,
      site,
      stateName,
      pga,
      amp,
      staLtaRatio,
      sampleRate,
      packetStartTime,
      isPureFrequencySeismic = true,
      freqDominantHz = 5.0,
      highFreqRatio = 0.6,
      triggered,
      triggerSampleIndex,
      triggerTimeIso,
      refinedPickIso,
      woodAndersonDispMm = 0,
      minPgaThreshold,
      noiseClass,
    } = params;

    const cleanSt = (station || '').trim().toUpperCase();
    if (cleanSt === 'H06E' || cleanSt === 'TECD' || cleanSt === 'IG.H06E' || cleanSt === 'SV.TECD') {
      if (this.activeTriggers.has(cleanSt)) this.activeTriggers.delete(cleanSt);
      return;
    }

    const isVertical = (channel || '').toUpperCase().endsWith('Z');
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
      !Number.isFinite(staLtaRatio) ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      return;
    }

    // Item 21: Ventana de medición de amplitud (60-90s) separada de la ventana de coincidencia
    // Sigue actualizando maxPga, maxAmp y Wood-Anderson durante el paso de la onda S y ondas superficiales.
    // Un paquete cuyo PGA no supera el ruido calibrado de su propio canal no es evidencia de sacudida y no sube los picos.
    const aboveNoise = pga >= (minPgaThreshold ?? 0);
    let ampTracker = this.amplitudeTrackingMap.get(cleanSt);
    if (ampTracker) {
      const elapsedSinceTriggerMs = packetTimeMs - ampTracker.tP;
      if (elapsedSinceTriggerMs <= this.amplitudeTrackingWindowMs) {
        if (aboveNoise) {
          if (pga > ampTracker.maxPga) ampTracker.maxPga = pga;
          if (amp > ampTracker.maxAmp) ampTracker.maxAmp = amp;
          if (woodAndersonDispMm > ampTracker.woodAndersonAmpMm) ampTracker.woodAndersonAmpMm = woodAndersonDispMm;
        }
        ampTracker.lastUpdateMs = packetTimeMs;

        // Actualizar en el sismo en curso si pertenece al evento activo
        this.updateActiveEarthquakeAmplitudes(cleanSt, ampTracker.maxPga, ampTracker.maxAmp, ampTracker.woodAndersonAmpMm);
      } else {
        this.amplitudeTrackingMap.delete(cleanSt);
      }
    }

    // Identificar tipo de red según helper unificado (Item 32)
    const isAm = isRaspberryShake(network);
    const isIG = isMexicanIGNetwork(network);
    const isProfessional = isProfessionalNetwork(network);

    // Parámetros unificados canónicos de disparo STA/LTA (Item 51)
    let reqRatio = DEFAULT_STA_LTA_CONFIG.thresholdStandard;
    let reqPga = DEFAULT_STA_LTA_CONFIG.minPgaStandard;

    if (isAm) {
      reqRatio = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdAmPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdAm;
      reqPga = DEFAULT_STA_LTA_CONFIG.minPgaAm;
    } else if (isIG) {
      reqRatio = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdIGPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdIG;
      reqPga = DEFAULT_STA_LTA_CONFIG.minPgaIG;
    } else if (isProfessional) {
      reqRatio = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdProfessionalPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdStandard;
      reqPga = DEFAULT_STA_LTA_CONFIG.minPgaProfessional;
    }

    const nowWall = Date.now();
    if (isVertical) this.noteChannelActivity(cleanSt, channel, nowWall);
    const isDetectionChannel = this.isPreferredDetectionChannel(cleanSt, channel, nowWall);

    const isTrigger = triggered ?? (staLtaRatio >= reqRatio);
    const canOpenTrigger = isVertical && isTrigger && isDetectionChannel;

    // Los picos solo suben con paquetes que superan el ruido calibrado del propio canal
    const peakPga = aboveNoise ? pga : 0;
    const peakAmp = aboveNoise ? amp : 0;
    const peakWa = aboveNoise ? woodAndersonDispMm : 0;

    // Si la estación ya disparó previamente con su fase P, los paquetes subsiguientes de coda u ondas S
    // (incluso con ratio inferior, otros canales o componentes horizontales) deben actualizar los picos sin borrar el disparo
    const existingTrigger = this.activeTriggers.get(cleanSt);
    if (!canOpenTrigger) {
      if (existingTrigger) {
        if (peakPga > existingTrigger.maxPga) existingTrigger.maxPga = peakPga;
        if (peakAmp > existingTrigger.maxAmp) existingTrigger.maxAmp = peakAmp;
        if (peakWa > (existingTrigger.woodAndersonAmpMm || 0)) existingTrigger.woodAndersonAmpMm = peakWa;
        existingTrigger.lastUpdateWallTime = nowWall;
        this.trackPhasePeaks(existingTrigger, peakPga, packetTimeMs);
        this.updateActiveEarthquakeAmplitudes(cleanSt, peakPga, peakAmp, peakWa);
        this.requestEvaluation();
      }
      return;
    }

    // El piso de PGA SOLO sirve para ABRIR el disparo por primera vez.
    if (!existingTrigger && pga < reqPga) {
      return;
    }

    // Actualizar amplitudes observadas de onda S / PGA total si hay un sismo activo
    this.updateActiveEarthquakeAmplitudes(cleanSt, peakPga, peakAmp, peakWa);

    // Item 13: tP preciso al milisegundo de la muestra que disparó (no cuantizado al inicio de paquete)
    let tP = packetTimeMs;
    if (triggerTimeIso) {
      const parsedMs = new Date(triggerTimeIso).getTime();
      if (!isNaN(parsedMs)) tP = parsedMs;
    } else if (triggerSampleIndex !== null && triggerSampleIndex !== undefined && sampleRate > 0) {
      tP = packetTimeMs + Math.round((triggerSampleIndex / sampleRate) * 1000);
    }
    if (refinedPickIso) {
      const refinedMs = new Date(refinedPickIso).getTime();
      if (!isNaN(refinedMs)) tP = refinedMs;
    }
    const tP_iso = new Date(tP).toISOString();

    let existing = existingTrigger;
    if (!existing) {
      // Un disparo sostenido cuyo onset ya expiró no se reabre: asociaría un tP viejo a otro evento
      if (packetTimeMs - tP > this.staleOnsetMs) return;

      existing = {
        station: cleanSt,
        network,
        channel,
        lat,
        lon,
        site,
        stateName,
        tP,
        tP_iso,
        receivedWallTime: nowWall, // hora de apertura: la ventana de asociación no se renueva con la coda
        lastUpdateWallTime: nowWall,
        staLtaRatio,
        maxPga: pga,
        maxAmp: amp,
        woodAndersonAmpMm: woodAndersonDispMm,
        isPureFrequency: isPureFrequencySeismic,
        freqDominantHz,
        highFreqRatio,
        reqRatio,
        reqPga,
        noiseClass,
        pPhasePga: pga,
      };
      this.activeTriggers.set(cleanSt, existing);

      // Iniciar seguimiento de amplitud para onda S (Item 21)
      if (!ampTracker) {
        ampTracker = {
          tP,
          maxPga: pga,
          maxAmp: amp,
          woodAndersonAmpMm: woodAndersonDispMm,
          lastUpdateMs: packetTimeMs,
        };
        this.amplitudeTrackingMap.set(cleanSt, ampTracker);
      }

      console.log(`[Detector:Trigger] Estación ${cleanSt} (${network}, ${channel}) disparó a las ${tP_iso} (Ratio: ${staLtaRatio.toFixed(2)}, PGA: ${pga} gal, Freq: ${freqDominantHz} Hz, Ruido: ${noiseClass ?? 'n/d'})`);
    } else {
      // Actualizar máximos del evento en curso para esta estación
      existing.lastUpdateWallTime = nowWall;
      if (peakPga > existing.maxPga) existing.maxPga = peakPga;
      if (peakAmp > existing.maxAmp) existing.maxAmp = peakAmp;
      if (peakWa > (existing.woodAndersonAmpMm || 0)) existing.woodAndersonAmpMm = peakWa;
      if (staLtaRatio > existing.staLtaRatio) existing.staLtaRatio = staLtaRatio;
      if (isPureFrequencySeismic) existing.isPureFrequency = true;
      this.trackPhasePeaks(existing, peakPga, packetTimeMs);
    }

    // Evaluar Coincidencia Espacial y Coherencia Física
    this.requestEvaluation();
  }

  /**
   * Limpia manualmente el estado de disparo de una estación cuando pasa a reposo o queda inactiva (Item 18)
   */
  public clearStationTrigger(station: string): void {
    const cleanSt = (station || '').trim().toUpperCase();
    if (this.activeTriggers.has(cleanSt)) {
      this.activeTriggers.delete(cleanSt);
    }
  }

  /**
   * Test de Tiempos Diferenciales Inter-Estación (P-12):
   * Validación física rigurosa y no circular.
   * Para cualquier par de estaciones (Si, Sj) disparadas por el mismo frente de onda P cortical regional:
   * |tP_i - tP_j| <= (dist(Si, Sj) / V_app) + deltaTol
   * V_app = 5.5 km/s (velocidad aparente de onda P cortical regional)
   * deltaTolSec = 1.8 s (tolerancia estricta para evitar falsos positivos con ráfagas simultáneas o ruido disperso)
   */
  public testDifferentialTravelTimes(triggers: StationTriggerRecord[]): {
    passes: boolean;
    validPairRatio: number;
    totalPairs: number;
    validPairs: number;
  } {
    if (triggers.length < 2) return { passes: false, validPairRatio: 0, totalPairs: 0, validPairs: 0 };

    const vTravel = 5.5; // km/s (velocidad de propagación aparente de onda P en corteza)
    const deltaTolSec = 1.8; // Tolerancia estricta anti-ruido (P-12)
    let totalPairs = 0;
    let validPairs = 0;

    for (let i = 0; i < triggers.length; i++) {
      for (let j = i + 1; j < triggers.length; j++) {
        const st1 = triggers[i];
        const st2 = triggers[j];

        const interDistKm = this.haversineDistanceKm(st1.lat, st1.lon, st2.lat, st2.lon);
        if (interDistKm > 350.0) {
          continue;
        }

        totalPairs++;
        const maxTravelTimeSec = (interDistKm / vTravel) + deltaTolSec;
        const dtObsSec = Math.abs(st1.tP - st2.tP) / 1000;

        if (dtObsSec <= maxTravelTimeSec) {
          validPairs++;
        }
      }
    }

    const validPairRatio = totalPairs > 0 ? validPairs / totalPairs : 0;
    // Exigir al menos 85% de coherencia en pares y máximo 1 par discordante si hay >= 6 pares (4+ estaciones)
    const invalidPairs = totalPairs - validPairs;
    const passes = totalPairs > 0 && (validPairs === totalPairs || (totalPairs >= 6 && invalidPairs <= 1 && validPairRatio >= 0.85));

    return {
      passes,
      validPairRatio: Number(validPairRatio.toFixed(2)),
      totalPairs,
      validPairs,
    };
  }

  /**
   * Coincidencia Cinemática Multiestación y Apertura Espacial:
   * Aplica clustering espacial estricto (apertura <= 220 km) y validación de tiempos diferenciales.
   * Elimina completamente falsos positivos y correlaciones erróneas entre estaciones distantes.
   */
  private evaluateSpatialCoincidence(): void {
    const now = Date.now();

    // Buscar eventos preliminares activos en los últimos 90s
    const pendingPreliminaryList = this.earthquakes.filter(
      (e) => e.status === 'PRELIMINARY' && (now - e.timeEpoch < 90000)
    );

    // Filtrar disparos activos recibidos en la ventana temporal reciente del servidor (90s para acomodar retraso de SeedLink)
    const triggers = Array.from(this.activeTriggers.values()).filter((tr) => {
      const wallAge = now - (tr.receivedWallTime || now);
      if (pendingPreliminaryList.length > 0) {
        return wallAge <= 90000 || pendingPreliminaryList.some(p => Math.abs(tr.tP - p.timeEpoch) <= 90000);
      }
      return wallAge <= 90000;
    });
    if (triggers.length === 0) return;

    // Filtrar estaciones únicas por código
    const uniqueMap = new Map<string, StationTriggerRecord>();
    triggers.forEach((t) => uniqueMap.set(t.station.toUpperCase(), t));
    const uniqueTriggers = Array.from(uniqueMap.values());

    // Filtrar estaciones calificadas con buen STA/LTA y aceleración real (no ruido basal).
    // El umbral es el base de la red con el que se abrió el disparo; el DSP ya exigió además el piso calibrado del canal.
    const qualifiedTriggers = uniqueTriggers.filter(t => {
      if (t.rejected) return false;
      const { minRatio, minPga } = this.triggerRequirements(t);
      return t.staLtaRatio >= minRatio && t.maxPga >= minPga;
    });

    // Diagnóstico visible para depurar estaciones disparadas (solo cuando cambia el conjunto de estaciones)
    if (uniqueTriggers.length >= 2) {
      const rows = uniqueTriggers.map(t => {
        const { minRatio, minPga } = this.triggerRequirements(t);
        const ok = t.staLtaRatio >= minRatio && t.maxPga >= minPga;
        return { ok, text: `${t.station}(${t.network}/${t.channel}) ratio=${t.staLtaRatio.toFixed(2)}/${minRatio} pga=${t.maxPga.toFixed(3)}/${minPga}gal ruido=${t.noiseClass ?? 'n/d'} ${ok ? 'OK' : 'insuficiente'}`, key: `${t.station}:${ok}` };
      });
      const signature = rows.map(r => r.key).sort().join(',');
      if (signature !== this.lastDiagSignature) {
        this.lastDiagSignature = signature;
        console.log(`[Detector:Diag] ${uniqueTriggers.length} estación(es) con disparo activo -> ${rows.map(r => r.text).join(' | ')}`);
      }
    }

    if (qualifiedTriggers.length < 2) {
      return;
    }

    // =========================================================================
    // CLUSTERING ESPACIAL: Buscar clusters coherentes de estaciones en radio regional
    // Regla: 5 estaciones para Guatemala y El Salvador, 3 para Chiapas, 2 para red IG mexicana fuera de Chiapas
    // =========================================================================
    for (let i = 0; i < qualifiedTriggers.length; i++) {
      const seedStation = qualifiedTriggers[i];
      const isSeedIG = isMexicanIGNetwork(seedStation.network);
      // Las estaciones de banda ancha de México (IG) están más espaciadas geográficamente (hasta 280-300 km)
      const clusterRadiusKm = isSeedIG ? 285.0 : 220.0;
      const cluster = qualifiedTriggers.filter(t => 
        this.haversineDistanceKm(seedStation.lat, seedStation.lon, t.lat, t.lon) <= clusterRadiusKm
      );

      // P-10 / P-11: Contar sitios geográficos independientes (separación mínima >= 3.5 km)
      // Evita duplicar sensores co-ubicados en un mismo predio/edificio (< 3.5 km)
      // mientras preserva estaciones cercanas independientes (ej. PAVE y PATR en Tacana a 10 km).
      const independentSites: StationTriggerRecord[] = [];
      const minSiteSeparationKm = 3.5;
      for (const st of cluster) {
        const isCloseToExisting = independentSites.some(
          site => this.haversineDistanceKm(st.lat, st.lon, site.lat, site.lon) < minSiteSeparationKm
        );
        if (!isCloseToExisting) {
          independentSites.push(st);
        }
      }

      // P-15: La condición regional se evalúa por mayoría del cluster o semilla,
      // no por la simple presencia de una sola estación aislada que contamine las reglas
      const guatCount = cluster.filter(t => isGuatemalaStation(t)).length;
      const salCount = cluster.filter(t => isElSalvadorStation(t)).length;
      const chiapasCount = cluster.filter(t => isChiapasStation(t)).length;
      const igCount = cluster.filter(t => isMexicanIGNetwork(t.network)).length;

      const isGuatCluster = guatCount >= 3 || (isGuatemalaStation(seedStation) && guatCount >= 2);
      const isSalCluster = salCount >= 3 || (isElSalvadorStation(seedStation) && salCount >= 2);
      const isChiapasCluster = chiapasCount >= 2 || (isChiapasStation(seedStation) && chiapasCount >= 1);
      const isFiveStationCluster = isGuatCluster || isSalCluster;

      let requiredStations = 3;
      let requiredIndependentSites = 2;
      if (isFiveStationCluster) {
        requiredStations = 5;
        requiredIndependentSites = 3; // Al menos 3 sitios físicamente separados por >= 15 km
      } else if (isChiapasCluster) {
        requiredStations = 3;
        requiredIndependentSites = 2;
      } else {
        const hasIG = igCount >= 2 || (isMexicanIGNetwork(seedStation.network) && igCount >= 1);
        requiredStations = hasIG ? 2 : 3;
        requiredIndependentSites = hasIG ? 2 : 2;
      }

      if (cluster.length >= requiredStations && independentSites.length >= requiredIndependentSites) {
        // Verificar si este cluster pertenece a un sismo activo / reciente (< 240s) en la misma región (< 350 km) o con estaciones compartidas
        const clusterCodes = new Set(cluster.map(c => (c.station || '').toUpperCase()));
        const recentSameRegion = this.earthquakes.find(e => {
          if (e.status !== 'PRELIMINARY' || (e as any).isLocked) return false;
          const elapsed = now - (e.timeEpoch || 0);
          if (elapsed > 240000) return false;
          const distSeed = this.haversineDistanceKm(seedStation.lat, seedStation.lon, e.latitude, e.longitude);
          if (distSeed <= 350.0) return true;
          const existingCodes = new Set((e.stations || []).map((s: any) => (s.station || s.code || '').toUpperCase()));
          let shared = 0;
          clusterCodes.forEach(code => {
            if (existingCodes.has(code)) shared++;
          });
          return shared >= 1 && distSeed <= 450.0;
        });

        if (recentSameRegion) {
          // Incorporar nuevas estaciones que acaban de disparar al evento activo
          const existingStationCodes = new Set(recentSameRegion.stations.map(s => s.station.toUpperCase()));
          let hasNewStations = false;
          const mergedStations = [...recentSameRegion.stations];

          for (const st of cluster) {
            const codeUpper = st.station.toUpperCase();
            if (!existingStationCodes.has(codeUpper)) {
              existingStationCodes.add(codeUpper);
              mergedStations.push(st);
              hasNewStations = true;
            } else {
              const existingSt = mergedStations.find(s => s.station.toUpperCase() === codeUpper);
              if (existingSt && st.maxPga > existingSt.maxPga) {
                existingSt.maxPga = st.maxPga;
                existingSt.staLtaRatio = Math.max(existingSt.staLtaRatio, st.staLtaRatio);
              }
            }
          }

          // Re-estimar el Epicentro exacto, la Profundidad y la Magnitud conforme llegan más estaciones
          if (hasNewStations || (now - (recentSameRegion.timeEpoch || 0) < 60000)) {
            const refinedEpi = this.estimateEpicenter(mergedStations);
            if (refinedEpi && refinedEpi.rmsResidualSec <= 2.8 && !isDegenerateGeometry(refinedEpi.azimuthalGap, mergedStations.length)) {
              const magData = this.estimateMagnitude(mergedStations, refinedEpi.latitude, refinedEpi.longitude, refinedEpi.depth);
              const newMag = Number((magData.magnitude || recentSameRegion.magnitude).toFixed(1));
              const newPga = Number(Math.max(recentSameRegion.maxPga, magData.maxPga).toFixed(2));
              const newInt = Math.max(recentSameRegion.maxIntensity, magData.maxIntensity);

              const distShiftKm = this.haversineDistanceKm(recentSameRegion.latitude, recentSameRegion.longitude, refinedEpi.latitude, refinedEpi.longitude);
              const depthDiff = Math.abs(recentSameRegion.depth - refinedEpi.depth);
              const magDiff = Math.abs(recentSameRegion.magnitude - newMag);

              // Si se sumaron estaciones o cambió de forma apreciable el epicentro, profundidad o magnitud:
              if (hasNewStations || distShiftKm >= 2.5 || depthDiff >= 3 || magDiff >= 0.1) {
                recentSameRegion.latitude = refinedEpi.latitude;
                recentSameRegion.longitude = refinedEpi.longitude;
                recentSameRegion.depth = refinedEpi.depth;
                recentSameRegion.location = refinedEpi.locationName;
                recentSameRegion.magnitude = hasNewStations ? newMag : Math.max(recentSameRegion.magnitude, newMag);
                recentSameRegion.maxPga = newPga;
                recentSameRegion.maxIntensity = newInt;
                recentSameRegion.stationCount = mergedStations.length;
                recentSameRegion.stations = mergedStations;
                recentSameRegion.reportNumber = (recentSameRegion.reportNumber || 1) + 1;
                recentSameRegion.azimuthalGap = refinedEpi.azimuthalGap;
                recentSameRegion.rmsResidualSec = refinedEpi.rmsResidualSec;
                recentSameRegion.sWaveArrivedCount = magData.sWaveArrivedCount;
                recentSameRegion.isSWaveConfirmed = magData.isSWaveConfirmed;

                // Confirmar solo con evidencia: >= 3 estaciones coherentes, onda S observada o 2 estaciones muy por encima de su piso
                const isConfirmedNow = this.evaluateConfirmation(mergedStations, newPga, magData.isSWaveConfirmed);
                recentSameRegion.clusterLevel = calculateClusterLevel(mergedStations.length, newPga, isConfirmedNow);
                recentSameRegion.status = isConfirmedNow ? 'CONFIRMED' : 'PRELIMINARY';
                recentSameRegion.magnitudeType = isConfirmedNow ? 'ML' : 'ML (Preliminar)';
                recentSameRegion.source = isConfirmedNow
                  ? `Sismo Confirmado por Red (${recentSameRegion.stationCount} estaciones)`
                  : `Sismo en Cálculo Dinámico (${recentSameRegion.stationCount} est, Nivel ${recentSameRegion.clusterLevel})`;
                recentSameRegion.saved = true;
                this.markEventStations(recentSameRegion);

                this.saveEarthquakesToDisk();
                console.log(`[Detector:Refine] 📡 REPORTE #${recentSameRegion.reportNumber} (Nivel ${recentSameRegion.clusterLevel}, Gap ${refinedEpi.azimuthalGap}°, RMS ${refinedEpi.rmsResidualSec}s): ${recentSameRegion.id} -> ${recentSameRegion.location} (${recentSameRegion.latitude}, ${recentSameRegion.longitude}), M ${recentSameRegion.magnitude}, Prof ${recentSameRegion.depth} km, ${recentSameRegion.stationCount} estaciones.`);

                if (this.onEventDetectedCallback) {
                  this.onEventDetectedCallback(recentSameRegion);
                }
              }
            }
          }
          return; // Evento ya atribuido y procesado; no continuar para evitar duplicados en el mismo tick
        }

        // Un evento ya confirmado (bloqueado) no se vuelve a declarar con los mismos disparos:
        // sin esto cada paquete de una estación disparada reenviaría y reescribiría el evento durante 90 s
        const lockedSameEvent = this.earthquakes.find(e =>
          (e.status === 'CONFIRMED' || (e as any).isLocked) &&
          now - (e.timeEpoch || 0) <= 240000 &&
          cluster.every(c => (e.stations || []).some((s: any) => (s.station || s.code || '').toUpperCase() === (c.station || '').toUpperCase()))
        );
        if (lockedSameEvent) continue;

        // Verificar apertura máxima entre cualquier par del cluster
        let clusterApertureKm = 0;
        for (let a = 0; a < cluster.length; a++) {
          for (let b = a + 1; b < cluster.length; b++) {
            const d = this.haversineDistanceKm(cluster[a].lat, cluster[a].lon, cluster[b].lat, cluster[b].lon);
            if (d > clusterApertureKm) clusterApertureKm = d;
          }
        }
        const maxAllowedAperture = (isMexicanIGNetwork(seedStation.network) && !isChiapasCluster) ? 295.0 : 220.0;
        if (clusterApertureKm > maxAllowedAperture) continue;

        // Debe existir aceleración sísmica sustancial (anti-ruido basal)
        // Para Guatemala y El Salvador exigir al menos 3 estaciones con aceleración notable; para México 2 estaciones
        const reqSignificant = isFiveStationCluster ? 3 : 2;
        const significantStations = cluster.filter(t => {
          const isIG = isMexicanIGNetwork(t.network);
          const isProf = isProfessionalNetwork(t.network);
          return t.maxPga >= (isIG ? 0.030 : (isProf ? 0.10 : 0.20));
        });
        if (significantStations.length < reqSignificant) continue;

        // Validación cinemática diferencial de tiempos de viaje (100% de los pares válidos)
        const diffTest = this.testDifferentialTravelTimes(cluster);
        if (!diffTest.passes) {
          const tag = isGuatCluster ? '[Guatemala]' : isSalCluster ? '[El Salvador]' : isChiapasCluster ? '[Chiapas]' : '';
          console.log(`[Detector] Cluster ${tag} rechazado por inconsistencia cinemática: pares válidos ${diffTest.validPairs}/${diffTest.totalPairs}.`);
          continue;
        }

        // P-13: Estimar hipocentro por inversión de Geiger con rechazo iterativo de outliers
        let candidateCluster = [...cluster];
        let epi = this.estimateEpicenter(candidateCluster);

        // Si el residual RMS es alto (> 1.8s) y tenemos más estaciones que el mínimo requerido,
        // intentar descartar iterativamente la estación con mayor residuo (outlier por glitch de reloj o ruido)
        if ((!epi || epi.rmsResidualSec > 1.8) && candidateCluster.length > requiredStations) {
          console.log(`[Detector] RMS inicial elevado (${epi?.rmsResidualSec}s), probando rechazo de outlier...`);
          let bestFilteredCluster = candidateCluster;
          let bestEpi = epi;

          for (let dropIdx = 0; dropIdx < candidateCluster.length; dropIdx++) {
            const subCluster = candidateCluster.filter((_, idx) => idx !== dropIdx);
            if (subCluster.length < requiredStations) continue;

            const subEpi = this.estimateEpicenter(subCluster);
            if (subEpi && (!bestEpi || subEpi.rmsResidualSec < bestEpi.rmsResidualSec)) {
              bestEpi = subEpi;
              bestFilteredCluster = subCluster;
            }
          }

          if (bestEpi && bestEpi.rmsResidualSec <= 1.8) {
            console.log(`[Detector] Outlier removido con éxito: RMS mejoró a ${bestEpi.rmsResidualSec}s con ${bestFilteredCluster.length} estaciones.`);
            candidateCluster = bestFilteredCluster;
            epi = bestEpi;
          }
        }

        if (!epi || epi.rmsResidualSec > 2.0 || isDegenerateGeometry(epi.azimuthalGap, candidateCluster.length)) {
          console.log(`[Detector] Cluster rechazado: Geiger no convergió o residual RMS excesivo (${epi?.rmsResidualSec}s).`);
          continue;
        }

        const regionNotice = isGuatCluster
          ? ' (GUATEMALA: ' + cluster.length + ' >= 5)'
          : isSalCluster
            ? ' (EL SALVADOR: ' + cluster.length + ' >= 5)'
            : isChiapasCluster
              ? ' (CHIAPAS: ' + cluster.length + ' >= 3)'
              : ' (IG MÉXICO: ' + cluster.length + ' >= 2)';
        console.log(`[Detector] Coincidencia multiestación validada${regionNotice}: ${candidateCluster.length} estaciones, apertura ${clusterApertureKm.toFixed(1)} km, RMS ${epi.rmsResidualSec}s.`);
        const declared = this.declareSeismicEvent(candidateCluster, epi);
        if (declared) return;
      } else if (isGuatCluster && cluster.length >= 2) {
        // Log informativo de progreso de corroboración para estaciones de Guatemala
        console.log(`[Detector:Guatemala] 🇬🇹 Estaciones de Guatemala en disparo: ${cluster.length}/5 estaciones requeridas para confirmación oficial.`);
      } else if (isSalCluster && cluster.length >= 2) {
        // Log informativo de progreso de corroboración para estaciones de El Salvador
        console.log(`[Detector:ElSalvador] 🇸🇻 Estaciones de El Salvador en disparo: ${cluster.length}/5 estaciones requeridas para confirmación oficial.`);
      } else if (cluster.length >= 2) {
        // [FIX] Antes este caso (cluster mexicano/estándar que no llega al mínimo) no dejaba ningún rastro
        console.log(`[Detector] Cluster insuficiente cerca de ${seedStation.station}: ${cluster.length}/${requiredStations} estaciones dentro de 200km. Estaciones: ${cluster.map(c => c.station).join(', ')}.`);
      }
    }
  }

  // =========================================================================
  // ETAPA 2: ESTIMACIÓN DEL EPICENTRO (EL "DÓNDE")
  // =========================================================================

  /**
   * Localización hipocentral mediante el algoritmo Sunflower Spiral y pérdida Pseudo-Huber
   * (Arquitectura GlobalQuake v0.11.0: ExactHypocenterFinder / HypocenterOptimizer).
   * 
   * 1. Elimina sesgos de grilla rectangular mediante distribución en espiral de Vogel (Golden Angle).
   * 2. Evalúa profundidades multiescala (5 - 200 km) con perfil de velocidad cortical/manto.
   * 3. Utiliza la función de pérdida Pseudo-Huber (suave L2 cerca de 0, asintótica L1) para
   *    inmunidad absoluta contra outliers, deriva de relojes o retrasos de red de estaciones aisladas.
   * 4. Estima t0 mediante la mediana robusta de tiempos observados.
   * 5. Calcula la brecha azimutal (Azimuthal Gap) y el grado de calidad (Quality Grade: A, B, C o D).
   */
  public estimateEpicenter(stations: StationTriggerRecord[]): {
    latitude: number;
    longitude: number;
    depth: number;
    t0_ms: number;
    rmsResidualSec: number;
    azimuthalGap: number;
    locationName: string;
  } | null {
    if (stations.length < 2) {
      // Rechazar y salir: nunca inventar coordenadas ni defaults plausibles (Item 30)
      return null;
    }

    // Centro inicial: Baricentro de las estaciones disparadas y estación más temprana
    let centerLat = 0;
    let centerLon = 0;
    let minTP = Infinity;
    let earliestStation = stations[0];

    stations.forEach((st) => {
      centerLat += st.lat;
      centerLon += st.lon;
      if (st.tP < minTP) {
        minTP = st.tP;
        earliestStation = st;
      }
    });
    centerLat /= stations.length;
    centerLon /= stations.length;

    // Calcular apertura del cluster de estaciones
    let clusterApertureKm = 0;
    for (let a = 0; a < stations.length; a++) {
      for (let b = a + 1; b < stations.length; b++) {
        const d = this.haversineDistanceKm(stations[a].lat, stations[a].lon, stations[b].lat, stations[b].lon);
        if (d > clusterApertureKm) clusterApertureKm = d;
      }
    }
    const maxAllowedDistFromEarliest = Math.max(220.0, clusterApertureKm * 1.6);

    // Rango de profundidades z a contrastar como parámetro libre (km) (GlobalQuake multi-depth search)
    const depthsToTest = [5.0, 10.0, 15.0, 25.0, 40.0, 60.0, 85.0, 120.0, 160.0, 200.0];

    // Puntos candidatos gruesos mediante espiral Sunflower de Vogel (GlobalQuake 0.11.0)
    const coarseRadiusKm = Math.max(180.0, clusterApertureKm * 1.5);
    const sunflowerCentroid = getSunflowerPoints(centerLat, centerLon, coarseRadiusKm, 80);
    const sunflowerEarliest = getSunflowerPoints(earliestStation.lat, earliestStation.lon, 90.0, 28);

    const candidatePoints: Array<{ lat: number; lon: number }> = [
      { lat: Number(centerLat.toFixed(4)), lon: Number(centerLon.toFixed(4)) },
      { lat: Number(earliestStation.lat.toFixed(4)), lon: Number(earliestStation.lon.toFixed(4)) },
      {
        lat: Number(((centerLat + earliestStation.lat) / 2).toFixed(4)),
        lon: Number(((centerLon + earliestStation.lon) / 2).toFixed(4)),
      },
      ...sunflowerCentroid,
      ...sunflowerEarliest,
    ];

    let bestLat = centerLat;
    let bestLon = centerLon;
    let bestDepth = 15.0;
    let bestT0 = minTP;
    let minLoss = Infinity;

    // Etapa 1: Búsqueda gruesa Sunflower con tiempos de viaje esféricos 1D y pérdida Pseudo-Huber (GlobalQuake 0.11.0)
    for (const pt of candidatePoints) {
      const distToEarliest = this.haversineDistanceKm(pt.lat, pt.lon, earliestStation.lat, earliestStation.lon);
      const distPenalty = distToEarliest > maxAllowedDistFromEarliest
        ? Math.pow((distToEarliest - maxAllowedDistFromEarliest) / 25.0, 2)
        : 0;

      for (const testDepth of depthsToTest) {
        const t0Estimates: number[] = new Array(stations.length);
        const travelTimesSec: number[] = new Array(stations.length);

        for (let i = 0; i < stations.length; i++) {
          const st = stations[i];
          const distSurfaceKm = this.haversineDistanceKm(pt.lat, pt.lon, st.lat, st.lon);
          const ttSec = calculateTravelTime1D(distSurfaceKm, testDepth, 'P');
          travelTimesSec[i] = ttSec;
          t0Estimates[i] = st.tP - ttSec * 1000;
        }

        // Estimación robusta del tiempo de origen t0 mediante mediana estadística (GlobalQuake)
        const candidateT0 = computeMedian(t0Estimates);

        // Penalización de causalidad física: el tiempo de origen no puede ser posterior al arribo inicial
        const causalityPenalty = (candidateT0 > earliestStation.tP + 100)
          ? Math.pow((candidateT0 - earliestStation.tP) / 400.0, 2) * 5.0
          : 0;

        // Función de pérdida Pseudo-Huber: robusta ante estaciones con delay o ruido.
        // Los priors débiles (0.002 s²/km horizontal, 0.001 s²/km en profundidad) solo desempatan cuando hay pocas
        // estaciones y la solución no es única: se prefiere el hipocentro somero más cercano a la estación más temprana.
        let loss = distPenalty + causalityPenalty + 0.002 * distToEarliest + 0.001 * testDepth;
        for (let i = 0; i < stations.length; i++) {
          const expectedArrivalMs = candidateT0 + travelTimesSec[i] * 1000;
          const resSec = (stations[i].tP - expectedArrivalMs) / 1000;
          loss += pseudoHuberLoss(resSec, 1.0);
        }

        if (loss < minLoss) {
          minLoss = loss;
          bestLat = pt.lat;
          bestLon = pt.lon;
          bestDepth = testDepth;
          bestT0 = candidateT0;
        }
      }
    }

    // Etapa 2: Refinamiento fino Sunflower local alrededor del mejor candidato
    const fineSunflowerPoints = getSunflowerPoints(bestLat, bestLon, 36.0, 48);
    fineSunflowerPoints.push({ lat: bestLat, lon: bestLon });

    const fineDepths = [
      Math.max(3.0, bestDepth - 14.0),
      Math.max(3.0, bestDepth - 7.0),
      bestDepth,
      Math.min(220.0, bestDepth + 7.0),
      Math.min(220.0, bestDepth + 14.0),
    ];

    for (const pt of fineSunflowerPoints) {
      const distToEarliest = this.haversineDistanceKm(pt.lat, pt.lon, earliestStation.lat, earliestStation.lon);
      const distPenalty = distToEarliest > maxAllowedDistFromEarliest
        ? Math.pow((distToEarliest - maxAllowedDistFromEarliest) / 18.0, 2)
        : 0;

      for (const testDepth of fineDepths) {
        const t0Estimates: number[] = new Array(stations.length);
        const travelTimesSec: number[] = new Array(stations.length);

        for (let i = 0; i < stations.length; i++) {
          const st = stations[i];
          const distSurfaceKm = this.haversineDistanceKm(pt.lat, pt.lon, st.lat, st.lon);
          const ttSec = calculateTravelTime1D(distSurfaceKm, testDepth, 'P');
          travelTimesSec[i] = ttSec;
          t0Estimates[i] = st.tP - ttSec * 1000;
        }

        const candidateT0 = computeMedian(t0Estimates);
        // Misma función de pérdida que la búsqueda gruesa (causalidad, prior y delta) para que ambas etapas sean comparables
        const causalityPenalty = (candidateT0 > earliestStation.tP + 100)
          ? Math.pow((candidateT0 - earliestStation.tP) / 400.0, 2) * 5.0
          : 0;
        let loss = distPenalty + causalityPenalty + 0.002 * distToEarliest + 0.001 * testDepth;
        for (let i = 0; i < stations.length; i++) {
          const expectedArrivalMs = candidateT0 + travelTimesSec[i] * 1000;
          const resSec = (stations[i].tP - expectedArrivalMs) / 1000;
          loss += pseudoHuberLoss(resSec, 1.0);
        }

        if (loss < minLoss) {
          minLoss = loss;
          bestLat = pt.lat;
          bestLon = pt.lon;
          bestDepth = testDepth;
          bestT0 = candidateT0;
        }
      }
    }

    // Etapa 3: pulido continuo (Nelder-Mead) de latitud, longitud y profundidad con la misma pérdida.
    // La rejilla de espiral solo localiza la cuenca; el simplex elimina el error de discretización (decenas de km).
    const kmPerDegLat = 111.195;
    const kmPerDegLon = 111.195 * Math.max(0.05, Math.cos((bestLat * Math.PI) / 180.0));
    const baseLat = bestLat;
    const baseLon = bestLon;
    const lossAt = (x: number[]): number => {
      const lat = baseLat + x[1] / kmPerDegLat;
      const lon = baseLon + x[0] / kmPerDegLon;
      const depth = Math.min(220.0, Math.max(3.0, x[2]));
      const distToEarliest = this.haversineDistanceKm(lat, lon, earliestStation.lat, earliestStation.lon);
      const t0s: number[] = new Array(stations.length);
      const tts: number[] = new Array(stations.length);
      for (let i = 0; i < stations.length; i++) {
        tts[i] = calculateTravelTime1D(this.haversineDistanceKm(lat, lon, stations[i].lat, stations[i].lon), depth, 'P');
        t0s[i] = stations[i].tP - tts[i] * 1000;
      }
      const t0 = computeMedian(t0s);
      let loss = 0.002 * distToEarliest + 0.001 * depth + Math.pow(Math.max(0, x[2] - 220.0) + Math.max(0, 3.0 - x[2]), 2);
      if (distToEarliest > maxAllowedDistFromEarliest) loss += Math.pow((distToEarliest - maxAllowedDistFromEarliest) / 18.0, 2);
      if (t0 > earliestStation.tP + 100) loss += Math.pow((t0 - earliestStation.tP) / 400.0, 2) * 5.0;
      for (let i = 0; i < stations.length; i++) loss += pseudoHuberLoss((stations[i].tP - (t0 + tts[i] * 1000)) / 1000, 1.0);
      return loss;
    };
    const polished = nelderMead(lossAt, [0, 0, bestDepth], [10, 10, 8], 120);
    if (polished.fx < minLoss) {
      minLoss = polished.fx;
      bestLat = baseLat + polished.x[1] / kmPerDegLat;
      bestLon = baseLon + polished.x[0] / kmPerDegLon;
      bestDepth = Math.min(220.0, Math.max(3.0, polished.x[2]));
      const t0s = stations.map((st) => st.tP - calculateTravelTime1D(this.haversineDistanceKm(bestLat, bestLon, st.lat, st.lon), bestDepth, 'P') * 1000);
      bestT0 = computeMedian(t0s);
    }

    // t0 final: media de las estaciones con residuo razonable (la mediana pura descarta información con 3 o más estaciones)
    {
      const t0s = stations.map((st) => st.tP - calculateTravelTime1D(this.haversineDistanceKm(bestLat, bestLon, st.lat, st.lon), bestDepth, 'P') * 1000);
      const inliers = t0s.filter((t) => Math.abs(t - bestT0) <= 1500);
      if (inliers.length >= 2) bestT0 = inliers.reduce((a, b) => a + b, 0) / inliers.length;
    }

    // Calcular RMS físico puro de tiempos de llegada (sin penalizaciones heurísticas de búsqueda)
    let pureSSR = 0;
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const distSurfaceKm = this.haversineDistanceKm(bestLat, bestLon, st.lat, st.lon);
      const ttSec = calculateTravelTime1D(distSurfaceKm, bestDepth, 'P');
      const expectedTimeMs = bestT0 + ttSec * 1000;
      const resSec = (st.tP - expectedTimeMs) / 1000;
      pureSSR += resSec * resSec;
    }
    const rmsResidualSec = Math.sqrt(pureSSR / stations.length);

    // Calcular Azimuthal Gap (GlobalQuake 0.11.0)
    const azimuthalGap = calculateAzimuthalGap(bestLat, bestLon, stations);
    const locationName = this.resolveMexicanLocation(bestLat, bestLon);

    return {
      latitude: Number(bestLat.toFixed(3)),
      longitude: Number(bestLon.toFixed(3)),
      depth: Math.round(bestDepth),
      t0_ms: Math.round(bestT0),
      rmsResidualSec: Number(rmsResidualSec.toFixed(2)),
      azimuthalGap,
      locationName,
    };
  }

  // =========================================================================
  // ETAPA 3: ESTIMACIÓN DE LA MAGNITUD (EL "QUÉ TAN FUERTE")
  // =========================================================================

  /**
   * Calcula la Magnitud Local (ML - Calibración regional para México y Centroamérica):
   * Basado en aceleración pico (PGA) y atenuación de onda S con distancia hipocentral:
   * R_hyp = sqrt(D^2 + depth^2) (García et al. / Hutton & Boore).
   */
  public estimateMagnitude(
    stations: StationTriggerRecord[],
    epiLat: number,
    epiLon: number,
    depthKm: number = 15.0
  ): {
    magnitude: number;
    maxPga: number;
    maxIntensity: number;
    validStationCount: number;
    sWaveArrivedCount: number;
    isSWaveConfirmed: boolean;
  } {
    let maxOverallPga = 0;
    let validStationCount = 0;
    let sWaveArrivedCount = 0;
    const mlEstimates: number[] = [];
    const nowMs = Date.now();

    stations.forEach((st) => {
      const distKm = Math.max(5.0, this.haversineDistanceKm(epiLat, epiLon, st.lat, st.lon));
      st.distanceKm = Number(distKm.toFixed(1));
      const hypDistKm = Math.hypot(distKm, depthKm);

      // Llegada esperada de la onda S (cuenta regresiva para la UI). Solo cuenta como llegada real si, pasada esa hora,
      // el pico supera claramente la fase P y el piso de la estación: el reloj por sí solo no demuestra nada.
      const ttP = calculateTravelTime1D(distKm, depthKm, 'P');
      const ttS = calculateTravelTime1D(distKm, depthKm, 'S');
      const sDelayMs = Math.round((ttS - ttP) * 1000);
      st.sWaveExpectedMs = st.tP + sDelayMs;
      st.sWaveCountdownSec = Math.max(0, Math.round((st.sWaveExpectedMs - nowMs) / 1000));
      const pPhasePga = st.pPhasePga ?? st.maxPga;
      const sPhasePga = st.sPhasePga ?? 0;
      st.sWaveArrived = nowMs >= st.sWaveExpectedMs &&
        sPhasePga >= Math.max(1.6 * pPhasePga, 2.5 * (st.reqPga ?? 0.05));
      if (st.sWaveArrived) {
        sWaveArrivedCount++;
        if (!st.tS) {
          st.tS = st.sWaveExpectedMs;
          st.tS_iso = new Date(st.tS).toISOString();
        }
      }

      // Descartar estaciones excesivamente lejanas (> 320 km) para el cálculo de magnitud
      // a fin de evitar que el ruido ambiental a gran distancia distorsione la magnitud
      if (distKm > 320.0) return;

      const isAm = isRaspberryShake(st.network);
      // Las estaciones AM solo se consideran si tienen un PGA claro y coherente
      if (isAm && (st.maxPga < 0.35 || st.staLtaRatio < 6.0)) return;

      if (st.maxPga > maxOverallPga) {
        maxOverallPga = st.maxPga;
      }
      validStationCount++;

      // Relación GMPE inversa calibrada para acelerómetros y sismómetros regionales:
      // M = (log10(PGA) + 1.60 * log10(R_hyp) + 0.0022 * R_hyp - 0.20) / 0.86
      const pgaEff = Math.max(0.015, st.maxPga);
      let ml = (Math.log10(pgaEff) + 1.60 * Math.log10(hypDistKm) + 0.0022 * hypDistKm - 0.20) / 0.86;

      // Estimador proxy Mwp (GlobalQuake): evita saturación de escala ML en eventos mayores (M >= 6.0)
      const pgaDistanceProduct = pgaEff * hypDistKm;
      if (pgaDistanceProduct > 800) {
        const mwpProxy = 0.88 * ml + 0.15 * Math.log10(pgaDistanceProduct);
        ml = Math.max(ml, Math.min(8.8, mwpProxy));
      }

      // Magnitud local Hutton & Boore (1987) a partir de la amplitud Wood-Anderson sintética (mm).
      // Se promedia con la estimación por PGA para no depender de un solo método.
      const waAmpMm = st.woodAndersonAmpMm || 0;
      if (waAmpMm > 0) {
        const dWa = Math.max(10.0, distKm);
        const mlWa = Math.log10(waAmpMm) + 1.11 * Math.log10(dWa / 100.0) + 0.00189 * (dWa - 100.0) + 3.0;
        if (isFinite(mlWa)) ml = isFinite(ml) ? (ml + mlWa) / 2.0 : mlWa;
      }

      if (!isNaN(ml) && isFinite(ml)) {
        const clampedML = Math.max(1.8, Math.min(8.6, ml));
        st.stationML = Number(clampedML.toFixed(2));
        console.log(`[Detector:ML] Estación ${st.station} (D=${distKm.toFixed(1)}km, R_hyp=${hypDistKm.toFixed(1)}km, PGA=${st.maxPga.toFixed(3)}gal, OndaS=${st.sWaveArrived ? 'Arribó' : `${st.sWaveCountdownSec}s`}): stationML=${clampedML.toFixed(2)}`);
        mlEstimates.push(clampedML);
      }
    });

    // Mediana robusta para descartar valores extremos y anomalías
    let officialML = 0;
    if (mlEstimates.length > 0) {
      mlEstimates.sort((a, b) => a - b);
      const mid = Math.floor(mlEstimates.length / 2);
      officialML = mlEstimates.length % 2 !== 0
        ? mlEstimates[mid]
        : (mlEstimates[mid - 1] + mlEstimates[mid]) / 2;
    }

    officialML = Number(officialML.toFixed(1));

    // Intensidad Mercalli máxima físicamente esperable según la magnitud del sismo:
    // Evita que picos de ruido aislados muestren intensidades absurdas (como IX para un sismo M3.8)
    const maxTheoreticalInt = officialML >= 7.8 ? 9
      : officialML >= 7.2 ? 8
      : officialML >= 6.5 ? 7
      : officialML >= 5.8 ? 6
      : officialML >= 5.0 ? 5
      : officialML >= 4.2 ? 4
      : officialML >= 3.4 ? 3
      : officialML >= 2.6 ? 2 : 1;

    const rawIntensity = SeismicDspEngine.pgaToMercalli(maxOverallPga);
    const maxIntensity = Math.min(maxTheoreticalInt, Math.max(1, rawIntensity));

    return {
      magnitude: officialML,
      maxPga: Number(maxOverallPga.toFixed(3)),
      maxIntensity,
      validStationCount,
      sWaveArrivedCount,
      isSWaveConfirmed: sWaveArrivedCount >= 2,
    };
  }

  /**
   * Actualiza dinámicamente las amplitudes pico de la onda S (ventana de 60-90s)
   * en el evento sísmico recién declarado (Item 21).
   */
  private updateActiveEarthquakeAmplitudes(
    station: string,
    pga: number,
    amp: number,
    woodAndersonAmpMm: number
  ): void {
    if (this.earthquakes.length === 0) return;
    const nowMs = Date.now();
    const recentEvent = this.earthquakes.find((event) => {
      const ageFromOriginMs = nowMs - event.timeEpoch;
      const ageFromDetectionMs = nowMs - new Date(event.detectedAt).getTime();
      return event.status === 'PRELIMINARY' &&
        !(event as any).isLocked &&
        ageFromOriginMs >= 0 && ageFromOriginMs <= 45000 &&
        ageFromDetectionMs >= 0 && ageFromDetectionMs <= 45000;
    });
    if (!recentEvent) return;

    let stIndex = recentEvent.stations.findIndex((s) => s.station === station);
    if (stIndex < 0) {
      const trig = this.activeTriggers.get(station);
      if (trig) {
        // P-17: Comprobar físicamente que la estación disparada esté en el rango de propagación del evento
        // Evita que un pico de ruido en GT/SV contamine un sismo en Oaxaca o Michoacán inflando su PGA y ML
        const distKm = this.haversineDistanceKm(recentEvent.latitude, recentEvent.longitude, trig.lat, trig.lon);
        const elapsedSec = Math.max(0, (nowMs - recentEvent.timeEpoch) / 1000);
        const maxPhysicalReachKm = (elapsedSec * 6.5) + 60.0; // Vp ~ 6.5 km/s + margen de hipocentro

        if (distKm > maxPhysicalReachKm || distKm > 350.0) {
          // Estación fuera del frente de onda físico del evento activo: ignorar para no contaminar
          return;
        }

        recentEvent.stations.push(trig);
        recentEvent.stationCount = recentEvent.stations.length;
        stIndex = recentEvent.stations.length - 1;
      } else {
        return;
      }
    }

    const st = recentEvent.stations[stIndex];
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

    if (pga > recentEvent.maxPga) {
      recentEvent.maxPga = pga;
      recentEvent.maxIntensity = SeismicDspEngine.pgaToMercalli(pga);
      changed = true;
    }

    if (changed) {
      // Re-estimar magnitud con el pico real de la onda S
      const updatedMag = this.estimateMagnitude(recentEvent.stations, recentEvent.latitude, recentEvent.longitude, recentEvent.depth);
        if (updatedMag.validStationCount > 0 &&
          (updatedMag.magnitude > recentEvent.magnitude || updatedMag.maxPga > recentEvent.maxPga)) {
        console.log(`[Detector:S-Wave] Actualización de pico de onda S para evento ${recentEvent.id}: M ${recentEvent.magnitude} -> ${updatedMag.magnitude}, PGA ${recentEvent.maxPga} -> ${updatedMag.maxPga} gal`);
        recentEvent.magnitude = updatedMag.magnitude;
        recentEvent.maxPga = updatedMag.maxPga;
        recentEvent.maxIntensity = updatedMag.maxIntensity;
        this.scheduleSave();
        if (this.onEventDetectedCallback) {
          this.onEventDetectedCallback(recentEvent);
        }
      }
    }
  }

  // =========================================================================
  // ETAPA 4: DECLARACIÓN Y PERSISTENCIA DEL SISMO
  // =========================================================================

  private declarePreliminaryCorroboratedEvent(
    triggers: StationTriggerRecord[],
    epi: { latitude: number; longitude: number; depth: number; t0_ms: number; locationName: string; rmsResidualSec?: number; azimuthalGap?: number }
  ): DetectedEarthquake | null {
    const magData = this.estimateMagnitude(triggers, epi.latitude, epi.longitude, epi.depth);
    if (magData.validStationCount === 0) {
      console.log('[Detector] Evento preliminar rechazado: ninguna estación produjo una magnitud válida.');
      return null;
    }
    const finalMag = Math.max(2.5, Number((magData.magnitude || 3.0).toFixed(1)));
    const finalPga = Math.max(0.05, Number((magData.maxPga || 0.1).toFixed(2)));
    const finalInt = Math.max(1, magData.maxIntensity || 1);

    // Cooldown solo después de verificar el evento
    this.lastDeclaredEventTime = Date.now();
    const nowIso = new Date().toISOString();
    const id = `eq-${nowIso.replace(/[-:T.Z]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;

    const displayId = generateDisplayId(id);
    const azimuthalGap = epi.azimuthalGap || 240;
    const rmsResidualSec = epi.rmsResidualSec || 1.2;
    const clusterLevel = calculateClusterLevel(triggers.length, finalPga, false);

    const event: DetectedEarthquake = {
      id,
      displayId,
      time: new Date(epi.t0_ms).toISOString(),
      timeEpoch: epi.t0_ms,
      detectedAt: nowIso,
      latitude: epi.latitude,
      longitude: epi.longitude,
      depth: epi.depth,
      magnitude: finalMag,
      magnitudeType: 'ML (Preliminar)',
      location: epi.locationName,
      maxPga: finalPga,
      maxIntensity: finalInt,
      stationCount: triggers.length,
      stations: triggers,
      status: 'PRELIMINARY',
      source: `Alerta Rápida Corroborada (Nivel ${clusterLevel}, ${triggers.length} estaciones)`,
      azimuthalGap,
      rmsResidualSec,
      clusterLevel,
      sWaveArrivedCount: magData.sWaveArrivedCount,
      isSWaveConfirmed: magData.isSWaveConfirmed,
    };

    this.activePreliminaryIds.add(id);

    // Guardar en memoria y disco
    this.earthquakes.unshift(event);
    if (this.earthquakes.length > 100) {
      this.earthquakes.pop();
    }
    this.saveEarthquakesToDisk();

    console.log(`[Detector] ⚠️ EVENTO PRELIMINAR CORROBORADO DECLARADO (Nivel ${clusterLevel}): ID=${id}, ${event.location}, M ${event.magnitude}, PGA=${event.maxPga} gal, Gap=${azimuthalGap}°, RMS=${rmsResidualSec}s, OndaS=${magData.isSWaveConfirmed ? 'Confirmada' : 'En tránsito'}`);

    if (this.onEventDetectedCallback) {
      this.onEventDetectedCallback(event);
    }

    return event;
  }

  private declareSeismicEvent(
    triggers: StationTriggerRecord[],
    precomputedEpi?: { latitude: number; longitude: number; depth: number; t0_ms: number; locationName: string; rmsResidualSec: number; azimuthalGap?: number }
  ): DetectedEarthquake | null {
    const nowIso = new Date().toISOString();
    
    // 1. Resolver Epicentro
    const epi = precomputedEpi || this.estimateEpicenter(triggers);
    if (!epi) {
      console.log(`[Detector] Sismo no declarado: datos insuficientes para resolver el epicentro sin suposiciones arbitrarias.`);
      return null;
    }

    // 2. Resolver Magnitud
    const magData = this.estimateMagnitude(triggers, epi.latitude, epi.longitude, epi.depth);
    if (magData.validStationCount === 0) {
      console.log('[Detector] Sismo no declarado: ninguna estación produjo una magnitud válida.');
      return null;
    }
    // Sin pisos artificiales: la magnitud y el PGA declarados son los que arrojan los datos
    const finalMag = Number(magData.magnitude.toFixed(1));
    const finalPga = Number(magData.maxPga.toFixed(2));
    const finalInt = Math.max(1, magData.maxIntensity || 1);

    // ARMAR COOLDOWN SOLO CUANDO EL EVENTO HA SIDO VERIFICADO Y DECLARADO
    this.lastDeclaredEventTime = Date.now();

    // Verificar si estamos actualizando un evento PRELIMINAR / ACTIVO existente (ventana de 4 minutos y coincidencia espacial / estaciones)
    let event: DetectedEarthquake;
    let existingIndex = -1;
    const nowMs = Date.now();
    const triggerCodes = new Set(triggers.map(t => (t.station || '').toUpperCase()));

    // Buscar si coincide con algún evento activo en la misma región espacial o con estaciones compartidas
    existingIndex = this.earthquakes.findIndex((e) => {
      const timeDiffMs = Math.abs((e.timeEpoch || 0) - epi.t0_ms);
      const elapsedMs = nowMs - (e.timeEpoch || 0);
      const distKm = this.haversineDistanceKm(e.latitude, e.longitude, epi.latitude, epi.longitude);

      // 1. Coincidencia espacial y temporal regional (< 320 km y < 4 minutos de origen)
      const isSpaceTimeMatch = (elapsedMs < 240000 || timeDiffMs < 120000) && distKm < 320.0;

      // 2. Coincidencia por estaciones compartidas (si comparten estaciones en disparo activo en los últimos 4 minutos)
      const existingStationCodes = new Set((e.stations || []).map((s: any) => (s.station || s.code || '').toUpperCase()));
      let sharedCount = 0;
      triggerCodes.forEach(code => {
        if (existingStationCodes.has(code)) sharedCount++;
      });
      const isStationOverlapMatch = (elapsedMs < 240000 || timeDiffMs < 120000) && sharedCount >= 1 && distKm < 450.0;

      return isSpaceTimeMatch || isStationOverlapMatch;
    });

    const azimuthalGap = epi.azimuthalGap || 180;
    const rmsResidualSec = epi.rmsResidualSec || 0.8;

    // Un sismo se confirma solo con evidencia física (ver evaluateConfirmation): >= 3 estaciones coherentes,
    // onda S observada en >= 2 estaciones, o 2 estaciones muy por encima de su piso con PGA >= 0.20 gal.
    // Ni el paso del tiempo ni el número de reportes confirman un evento; uno ya confirmado nunca se degrada.
    const prevEvent = existingIndex >= 0 ? this.earthquakes[existingIndex] : null;
    const isOfficiallyConfirmed = prevEvent?.status === 'CONFIRMED' ||
      this.evaluateConfirmation(triggers, finalPga, magData.isSWaveConfirmed);

    const clusterLevel = calculateClusterLevel(triggers.length, finalPga, isOfficiallyConfirmed);

    if (existingIndex >= 0) {
      const prev = this.earthquakes[existingIndex];
      this.activePreliminaryIds.delete(prev.id);

      event = {
        ...prev,
        latitude: epi.latitude,
        longitude: epi.longitude,
        depth: epi.depth,
        magnitude: finalMag,
        magnitudeType: isOfficiallyConfirmed ? 'ML' : 'ML (Preliminar)',
        location: epi.locationName,
        maxPga: Math.max(prev.maxPga, finalPga),
        maxIntensity: Math.max(prev.maxIntensity, finalInt),
        stationCount: Math.max(prev.stationCount || 0, triggers.length),
        stations: triggers,
        status: isOfficiallyConfirmed ? 'CONFIRMED' : 'PRELIMINARY',
        source: isOfficiallyConfirmed
          ? `Confirmado por Red (Nivel ${clusterLevel}, ${triggers.length} estaciones)`
          : `Sismo en Progreso (Reporte #${((prev as any).reportNumber || 1) + 1}, Nivel ${clusterLevel})`,
        azimuthalGap,
        rmsResidualSec,
        clusterLevel,
        sWaveArrivedCount: magData.sWaveArrivedCount,
        isSWaveConfirmed: magData.isSWaveConfirmed,
        saved: true,
      };
      (event as any).reportNumber = ((prev as any).reportNumber || 1) + 1;
      if (isOfficiallyConfirmed) {
        (event as any).isLocked = true;
      }
      this.earthquakes[existingIndex] = event;
      console.log(`[Detector] 🎯 EVENTO ACTUALIZADO/REFINADO: ID: ${event.id}, M ${event.magnitude}, ${event.location} (Status: ${event.status}, Nivel: ${clusterLevel}, Gap: ${azimuthalGap}°, RMS: ${rmsResidualSec}s, Onda S: ${magData.isSWaveConfirmed ? 'Confirmada' : 'En camino'})`);
    } else {
      const id = `eq-${nowIso.replace(/[-:T.Z]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
      const displayId = generateDisplayId(id);
      event = {
        id,
        displayId,
        time: new Date(epi.t0_ms).toISOString(),
        timeEpoch: epi.t0_ms,
        detectedAt: nowIso,
        latitude: epi.latitude,
        longitude: epi.longitude,
        depth: epi.depth,
        magnitude: finalMag,
        magnitudeType: isOfficiallyConfirmed ? 'ML' : 'ML (Preliminar)',
        location: epi.locationName,
        maxPga: finalPga,
        maxIntensity: finalInt,
        stationCount: triggers.length,
        stations: triggers,
        status: isOfficiallyConfirmed ? 'CONFIRMED' : 'PRELIMINARY',
        source: isOfficiallyConfirmed
          ? `Confirmado por Red (Nivel ${clusterLevel}, ${triggers.length} estaciones)`
          : `Alerta Rápida Inicial (Nivel ${clusterLevel}, ${triggers.length} est)`,
        azimuthalGap,
        rmsResidualSec,
        clusterLevel,
        sWaveArrivedCount: magData.sWaveArrivedCount,
        isSWaveConfirmed: magData.isSWaveConfirmed,
        saved: true,
      };
      (event as any).reportNumber = 1;
      if (isOfficiallyConfirmed) {
        (event as any).isLocked = true;
      }
      this.earthquakes.unshift(event);
      if (this.earthquakes.length > 100) {
        this.earthquakes.pop();
      }
      console.log(`[Detector] ¡SISMO INICIAL DECLARADO! ID: ${id} [${displayId}], M ${event.magnitude}, ${event.location} (Status: ${event.status}, Nivel: ${clusterLevel}, Gap: ${azimuthalGap}°, RMS: ${rmsResidualSec}s)`);
    }

    this.markEventStations(event);
    this.saveEarthquakesToDisk();

    // Notificar al listener WebSocket
    if (this.onEventDetectedCallback) {
      this.onEventDetectedCallback(event);
    }

    return event;
  }

  /**
   * Declara un microsismo local para catalogación científica (Caso C).
   * Se guarda en el catálogo histórico y se notifica al UI sin activar sirenas de alarma pública.
   */
  private declareMicroSeismicEvent(
    triggers: StationTriggerRecord[],
    epi: { latitude: number; longitude: number; depth: number; t0_ms: number; locationName: string; rmsResidualSec: number; azimuthalGap?: number }
  ): DetectedEarthquake | null {
    const nowIso = new Date().toISOString();
    const magData = this.estimateMagnitude(triggers, epi.latitude, epi.longitude, epi.depth);

    // Corte de magnitud para Caso C: microsismos M >= 1.8 se registran; menores a 1.8 se descartan
    if (magData.magnitude < 1.8 && magData.maxPga < 0.03) {
      console.log(`[Detector] Microsismo descartado por baja energía (< 1.8): M ${magData.magnitude}, PGA ${magData.maxPga} gal.`);
      return null;
    }

    // Regla estricta: para estaciones o territorio de Guatemala o El Salvador se requieren siempre 5 estaciones
    const isGuat = isGuatemalaStation(triggers[0]) || triggers.some(t => isGuatemalaStation(t)) ||
      epi.locationName.toLowerCase().includes('guatemala') ||
      (epi.latitude >= 13.6 && epi.latitude <= 18.1 && epi.longitude >= -92.4 && epi.longitude <= -88.1);
    const isSal = isElSalvadorStation(triggers[0]) || triggers.some(t => isElSalvadorStation(t)) ||
      epi.locationName.toLowerCase().includes('salvador') ||
      (epi.latitude >= 13.0 && epi.latitude <= 14.55 && epi.longitude >= -90.2 && epi.longitude <= -87.5);

    if ((isGuat || isSal) && triggers.length < 5) {
      const regionLabel = isGuat ? 'Guatemala' : 'El Salvador';
      console.log(`[Detector] Evento en ${regionLabel} descartado: se requieren 5 estaciones confirmadas (cuenta actual: ${triggers.length}/5).`);
      return null;
    }

    this.lastDeclaredEventTime = Date.now();

    const id = `micro-${nowIso.replace(/[-:T.Z]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
    const displayId = generateDisplayId(id);
    const azimuthalGap = epi.azimuthalGap || 180;
    const rmsResidualSec = epi.rmsResidualSec || 0.8;

    const event: DetectedEarthquake = {
      id,
      displayId,
      time: new Date(epi.t0_ms).toISOString(),
      timeEpoch: epi.t0_ms,
      detectedAt: nowIso,
      latitude: epi.latitude,
      longitude: epi.longitude,
      depth: Math.max(1.0, epi.depth),
      magnitude: magData.magnitude,
      magnitudeType: 'ML',
      location: epi.locationName,
      maxPga: magData.maxPga,
      maxIntensity: Math.max(1, magData.maxIntensity),
      stationCount: triggers.length,
      stations: triggers,
      status: 'CONFIRMED',
      source: 'Catálogo de Microsismos (Sin Alerta Pública)',
      isMicro: true,
      isAlert: false,
      azimuthalGap,
      rmsResidualSec,
      clusterLevel: 3,
    };

    this.earthquakes.unshift(event);
    if (this.earthquakes.length > 100) {
      this.earthquakes.pop();
    }
    this.saveEarthquakesToDisk();

    console.log(`[Detector] 🔬 MICROSISMO REGISTRADO AL CATÁLOGO: ID=${id} [${displayId}], ${event.location}, M ${event.magnitude}, PGA=${event.maxPga} gal, Gap=${azimuthalGap}°, RMS=${rmsResidualSec}s`);

    if (this.onEventDetectedCallback) {
      this.onEventDetectedCallback(event);
    }

    return event;
  }

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
    const location = custom?.location ?? this.resolveMexicanLocation(lat, lon);
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
    if (this.onEventDetectedCallback) {
      this.onEventDetectedCallback(event);
    }

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
          if (this.onEventDetectedCallback) {
            this.onEventDetectedCallback(confirmedEvent);
          }
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
      return elapsed < 300000 || this.activePreliminaryIds.has(e.id);
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
      this.activeTriggers.clear();
      this.amplitudeTrackingMap.clear();

      this.earthquakes = this.earthquakes.filter((e) => {
        const isRecent = nowMs - (e.timeEpoch || 0) < 300000;
        if (isRecent || e.status === 'PRELIMINARY') {
          removed.push(e);
          return false;
        }
        return true;
      });

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

  public clearEarthquakeHistory(): void {
    this.earthquakes = [];
    this.saveEarthquakesToDisk();
    console.log('[Detector] Historial sísmico eliminado por completo de memoria y disco');
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
      // Si el evento existente proviene de la red local, conservar las estaciones y detalles locales
      this.earthquakes[existingIndex] = {
        ...prev,
        ...event,
        magnitude: Math.max(prev.magnitude || 0, event.magnitude || 0),
        maxPga: Math.max(prev.maxPga || 0, event.maxPga || 0),
        stationCount: Math.max(prev.stationCount || 0, event.stationCount || 0),
        stations: prev.stations && prev.stations.length > 0 ? prev.stations : event.stations,
        status: 'CONFIRMED',
        saved: true,
      };
      this.saveEarthquakesToDisk();
      return false;
    } else {
      this.earthquakes.unshift({ ...event, status: 'CONFIRMED', saved: true });
      if (this.earthquakes.length > 100) this.earthquakes.pop();
      this.saveEarthquakesToDisk();
      if (this.onEventDetectedCallback) {
        this.onEventDetectedCallback(event);
      }
      return true;
    }
  }

  // =========================================================================
  // UTILIDADES MATEMÁTICAS Y GEOGRÁFICAS
  // =========================================================================

  private haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371.0; // Radio medio de la Tierra en km
    const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
    const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180.0) *
        Math.cos((lat2 * Math.PI) / 180.0) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private resolveMexicanLocation(lat: number, lon: number): string {
    // Cobertura de regiones en Japón (Tohoku, Iwate, Morioka, Miyagi, Sendai, Kanto)
    if (lon > 120 && lon < 150 && lat > 28 && lat < 48) {
      if (lat >= 39.2 && lat <= 40.4 && lon >= 140.7 && lon <= 142.2) return 'Morioka, Prefectura de Iwate (Japón)';
      if (lat >= 37.8 && lat < 39.2 && lon >= 140.6 && lon <= 142.1) return 'Sendai / Costa de Miyagi (Japón)';
      if (lat >= 36.6 && lat < 37.8 && lon >= 139.8 && lon <= 141.5) return 'Fukushima (Japón)';
      if (lat >= 35.0 && lat < 36.6 && lon >= 138.8 && lon <= 140.8) return 'Tokyo / Región de Kanto (Japón)';
      return 'Costa Este de Tohoku (Japón)';
    }

    // =========================================================================
    // BOUNDING BOX DE SALIDA Y REGIONES INTERNACIONALES (Item 29):
    // Cobertura completa multirregional: México (SSN/AM/BC/UV), Guatemala (INSIVUMEH),
    // El Salvador (MARN/SNET) y Honduras (COPECO/UNAH).
    // Si la solución cae fuera de esta área geográfica, reportarla como fuera de región.
    // =========================================================================
    if (lat < 12.5 && lon > -87.0) {
      return 'Región de Nicaragua / Costa Rica (Fuera de cobertura)';
    }
    if (lat > 33.2) {
      return 'Frontera Norte / EE.UU. (Fuera de cobertura)';
    }
    if (lon < -119.5 || lon > -83.0) {
      return 'Océano / Fuera de territorio de cobertura';
    }

    let closestCity = SeismicDetectorEngine.REFERENCE_CITIES[0];
    let minDist = Infinity;

    for (const city of SeismicDetectorEngine.REFERENCE_CITIES) {
      const d = this.haversineDistanceKm(lat, lon, city.lat, city.lon);
      if (d < minDist) {
        minDist = d;
        closestCity = city;
      }
    }

    const distKm = Math.round(minDist);
    if (distKm <= 8) {
      return `Cerca de ${closestCity.name}, ${closestCity.state}`;
    }

    // Calcular rumbo cardinal (N, NE, E, SE, S, SO, O, NO)
    const dLat = lat - closestCity.lat;
    const dLon = (lon - closestCity.lon) * Math.cos((closestCity.lat * Math.PI) / 180);
    const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI; // -180 a 180 (0 = Norte, 90 = Este)
    let dir = 'Sur';
    if (angle >= -22.5 && angle < 22.5) dir = 'Norte';
    else if (angle >= 22.5 && angle < 67.5) dir = 'Noreste';
    else if (angle >= 67.5 && angle < 112.5) dir = 'Este';
    else if (angle >= 112.5 && angle < 157.5) dir = 'Sureste';
    else if (angle >= 157.5 || angle < -157.5) dir = 'Sur';
    else if (angle >= -157.5 && angle < -112.5) dir = 'Suroeste';
    else if (angle >= -112.5 && angle < -67.5) dir = 'Oeste';
    else if (angle >= -67.5 && angle < -22.5) dir = 'Noroeste';

    // Distancia superior a 250 km de cualquier ciudad mexicana
    if (distKm > 250) {
      // Si está en el Océano Pacífico al suroeste o sur de la costa mexicana
      if (lat < closestCity.lat && (dir.includes('Sur') || dir.includes('Oeste'))) {
        return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state} (Océano Pacífico)`;
      }
      return `Fuera de región nacional (${distKm} km al ${dir} de la frontera mexicana)`;
    }

    return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state}`;
  }

  private pgaToMercalli(pga: number): number {
    return SeismicDspEngine.pgaToMercalli(pga);
  }
}