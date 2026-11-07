/**
 * MODELO REGIONAL DE TIEMPOS DE VIAJE (DOS CAPAS: CORTEZA SOBRE MANTO SUPERIOR)
 *
 * Corteza Vp 6.1 km/s sobre manto Vp 8.04 km/s con el Moho a 35 km, continuo con la profundidad, y Vs = Vp / 1.732.
 * La rejilla precalculada permite evaluar decenas de miles de hipótesis hipocentrales por búsqueda.
 */

export const EARTH_RADIUS_KM = 6371.0;
export const MOHO_DEPTH_KM = 35.0;
export const VP_VS_RATIO = 1.732; // Relación de Poisson elástica teórica de Wadati para ondas P y S
const VP_CRUST_KMS = 6.1;
const VP_MANTLE_KMS = 8.04;

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

/** Corrección de elevación de la estación (s): la onda debe subir hasta la superficie real */
export function elevationCorrectionSec(elevationM: number): number {
  return Number.isFinite(elevationM) ? elevationM / 6000.0 : 0;
}
