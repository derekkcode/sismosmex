/**
 * MAGNITUD LOCAL (ML), INTENSIDAD Y ONDA S DE UN SISMO A PARTIR DE LOS REGISTROS DE SUS ESTACIONES
 */

import {
  SeismicDspEngine,
  isRaspberryShake,
} from './seismic-dsp.js';
import { greatCircleKm } from './gq-geo.js';
import { calculateTravelTime1D } from './travel-time.js';
import type { StationTriggerRecord } from './earthquake-types.js';

// Un sitio independiente debe estar a >= 3.5 km de los demás: los disparos co-ubicados cuentan como uno solo
export const MIN_SITE_SEPARATION_KM = 3.5;

// Las estaciones a más de esta distancia epicentral no entran en la magnitud ni en el conteo de onda S
const MAX_MAGNITUDE_DISTANCE_KM = 320.0;

// Ventana de la onda S esperada: el pico de la sacudida debe caer en ella para contar como llegada observada.
// Con datos reales verticales el pico cae en esta ventana en ~2/3 de las estaciones con señal clara, mientras que
// un pico de ruido aislado solo cae por azar en ~1/10 de ellas.
const S_WINDOW_BEFORE_MS = 1500;
const S_WINDOW_AFTER_MS = 4000;
const S_WINDOW_AFTER_FRACTION = 0.4; // de la diferencia S-P
const S_WAVE_MIN_SNR = 4;
const S_WAVE_PEAK_FRACTION = 0.9;
const MIN_NOISE_PGA_GAL = 0.0005;

// La relación por PGA subestima ~0.9 unidades frente al catálogo en sismos reales; el respaldo la compensa
const PGA_FALLBACK_OFFSET = 0.9;

export interface MagnitudeEstimate {
  magnitude: number;
  maxPga: number;
  maxIntensity: number;
  validStationCount: number;
  sWaveArrivedCount: number;
  isSWaveConfirmed: boolean;
}

/**
 * Sitios físicamente independientes: entre registros a menos de 3.5 km cuenta solo el primero en llegar.
 * Devuelve las referencias originales en orden de llegada.
 */
export function independentSites(records: StationTriggerRecord[]): StationTriggerRecord[] {
  const sites: StationTriggerRecord[] = [];
  for (const r of [...records].sort((a, b) => a.tP - b.tP)) {
    const coLocated = sites.some((s) => greatCircleKm(r.lat, r.lon, s.lat, s.lon) < MIN_SITE_SEPARATION_KM);
    if (!coLocated) sites.push(r);
  }
  return sites;
}

/** Ventana (ms) donde se espera el pico de la onda S de un registro cuya llegada S esperada ya fue calculada */
export function sWaveWindowMs(record: Pick<StationTriggerRecord, 'tP' | 'sWaveExpectedMs'>): { startMs: number; endMs: number } | null {
  if (record.sWaveExpectedMs === undefined) return null;
  const sMinusPMs = Math.max(0, record.sWaveExpectedMs - record.tP);
  return {
    startMs: record.sWaveExpectedMs - S_WINDOW_BEFORE_MS,
    endMs: record.sWaveExpectedMs + S_WINDOW_AFTER_MS + S_WINDOW_AFTER_FRACTION * sMinusPMs,
  };
}

/**
 * Marca las estaciones donde la onda S ya llegó y devuelve cuántos sitios independientes dentro de 320 km la registraron.
 * Una llegada S observada exige que la ventana de la S esperada ya haya terminado, que el pico de PGA del registro caiga
 * dentro de ella y que supere claramente el ruido previo de la propia estación: el reloj por sí solo no demuestra nada.
 */
export function markSWaveArrivals(
  stations: StationTriggerRecord[],
  epiLat: number,
  epiLon: number,
  depthKm: number,
  nowMs: number
): number {
  const arrivedInRange: StationTriggerRecord[] = [];
  for (const st of stations) {
    const distKm = Math.max(5.0, greatCircleKm(epiLat, epiLon, st.lat, st.lon));
    st.distanceKm = Number(distKm.toFixed(1));

    const ttP = calculateTravelTime1D(distKm, depthKm, 'P');
    const ttS = calculateTravelTime1D(distKm, depthKm, 'S');
    const sDelayMs = Math.round((ttS - ttP) * 1000);
    st.sWaveExpectedMs = st.tP + sDelayMs;
    st.sWaveCountdownSec = Math.max(0, Math.round((st.sWaveExpectedMs - nowMs) / 1000));

    const window = sWaveWindowMs(st);
    const sPeak = st.sWindowPga ?? 0;
    const noise = Math.max(st.noisePga ?? 0, MIN_NOISE_PGA_GAL);
    st.sWaveArrived = window !== null &&
      nowMs >= window.endMs &&
      sPeak >= S_WAVE_PEAK_FRACTION * st.maxPga &&
      sPeak >= S_WAVE_MIN_SNR * noise;
    if (!st.sWaveArrived) continue;

    if (!st.tS) {
      st.tS = st.sWaveExpectedMs;
      st.tS_iso = new Date(st.tS).toISOString();
    }
    if (distKm <= MAX_MAGNITUDE_DISTANCE_KM) arrivedInRange.push(st);
  }
  return independentSites(arrivedInRange).length;
}

/** Magnitud local de Hutton & Boore (1987) a partir de la amplitud Wood-Anderson sintética (mm) a distancia hipocentral R */
export function localMagnitudeFromWoodAnderson(waAmpMm: number, hypocentralKm: number): number {
  const r = Math.max(10.0, hypocentralKm);
  return Math.log10(waAmpMm) + 1.11 * Math.log10(r / 100.0) + 0.00189 * (r - 100.0) + 3.0;
}

/**
 * Calcula la Magnitud Local (ML) como mediana de las estaciones. Por estación se usa la amplitud Wood-Anderson sintética
 * (Hutton & Boore, 1987), que contra sismos reales de Baja California y México reproduce el catálogo con una mediana de
 * residuos de -0.2 a 0.0 unidades. La aceleración pico solo se usa si la estación no tiene amplitud Wood-Anderson y
 * como cota inferior para sismos grandes, donde la amplitud Wood-Anderson se satura.
 */
export function estimateMagnitude(
  stations: StationTriggerRecord[],
  epiLat: number,
  epiLon: number,
  depthKm: number = 15.0,
  nowMs: number = Date.now()
): MagnitudeEstimate {
  let maxOverallPga = 0;
  let validStationCount = 0;
  const mlEstimates: number[] = [];
  const sWaveArrivedCount = markSWaveArrivals(stations, epiLat, epiLon, depthKm, nowMs);

  for (const st of stations) {
    const distKm = Math.max(5.0, greatCircleKm(epiLat, epiLon, st.lat, st.lon));
    const hypDistKm = Math.hypot(distKm, depthKm);

    // Las estaciones excesivamente lejanas no entran: el ruido ambiental a gran distancia distorsionaría la magnitud
    if (distKm > MAX_MAGNITUDE_DISTANCE_KM) continue;

    // Las estaciones AM (Raspberry Shake) solo cuentan con un PGA claro y un cociente fuerte
    if (isRaspberryShake(st.network) && (st.maxPga < 0.35 || st.staLtaRatio < 6.0)) continue;

    // Sin ninguna medida (canal recién iniciado) la estación no aporta a la magnitud
    if (!(st.woodAndersonAmpMm && st.woodAndersonAmpMm > 0) && !(st.maxPga > 0)) continue;

    if (st.maxPga > maxOverallPga) maxOverallPga = st.maxPga;
    validStationCount++;

    // Relación de la aceleración pico con la distancia hipocentral (cota para sismos grandes y respaldo sin Wood-Anderson):
    // M = (log10(PGA) + 1.60 * log10(R_hyp) + 0.0022 * R_hyp - 0.20) / 0.86
    const pgaEff = Math.max(0.015, st.maxPga);
    const mlPga = (Math.log10(pgaEff) + 1.60 * Math.log10(hypDistKm) + 0.0022 * hypDistKm - 0.20) / 0.86;

    const waAmpMm = st.woodAndersonAmpMm || 0;
    let ml = waAmpMm > 0 ? localMagnitudeFromWoodAnderson(waAmpMm, hypDistKm) : mlPga + PGA_FALLBACK_OFFSET;

    // Estimador proxy Mwp: evita saturación de la escala ML en eventos mayores (M >= 6.0)
    const pgaDistanceProduct = pgaEff * hypDistKm;
    if (pgaDistanceProduct > 800) {
      const mwpProxy = 0.88 * mlPga + 0.15 * Math.log10(pgaDistanceProduct);
      ml = Math.max(ml, Math.min(8.8, mwpProxy));
    }

    if (Number.isFinite(ml)) {
      const clamped = Math.max(0.5, Math.min(8.6, ml));
      st.stationML = Number(clamped.toFixed(2));
      mlEstimates.push(clamped);
    }
  }

  let officialML = 0;
  if (mlEstimates.length > 0) {
    mlEstimates.sort((a, b) => a - b);
    const mid = Math.floor(mlEstimates.length / 2);
    officialML = mlEstimates.length % 2 !== 0 ? mlEstimates[mid] : (mlEstimates[mid - 1] + mlEstimates[mid]) / 2;
  }
  officialML = Number(officialML.toFixed(1));

  // Intensidad Mercalli máxima físicamente esperable según la magnitud: evita que picos aislados muestren
  // intensidades absurdas (como IX para un sismo M3.8)
  const maxTheoreticalInt = officialML >= 7.8 ? 9
    : officialML >= 7.2 ? 8
    : officialML >= 6.5 ? 7
    : officialML >= 5.8 ? 6
    : officialML >= 5.0 ? 5
    : officialML >= 4.2 ? 4
    : officialML >= 3.4 ? 3
    : officialML >= 2.6 ? 2 : 1;

  const maxIntensity = Math.min(maxTheoreticalInt, Math.max(1, SeismicDspEngine.pgaToMercalli(maxOverallPga)));

  return {
    magnitude: officialML,
    maxPga: Number(maxOverallPga.toFixed(3)),
    maxIntensity,
    validStationCount,
    sWaveArrivedCount,
    isSWaveConfirmed: sWaveArrivedCount >= 2,
  };
}
