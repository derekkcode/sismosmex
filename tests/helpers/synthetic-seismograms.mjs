/**
 * SISMOGRAMAS SINTÉTICOS PARA PRUEBAS DEL DETECTOR
 *
 * Ruido de fondo de banda ancha más un sismo local: onda P, onda S (2.5 veces mayor) y coda con decaimiento
 * exponencial. La amplitud sigue una atenuación empírica de la velocidad pico en función de la magnitud y la
 * distancia hipocentral (log10 PGV[cm/s] = -2.54 + 0.82 M - 1.45 log10 R). No sustituye a datos reales: sirve para
 * verificar la lógica de detección, asociación y localización con geometrías conocidas.
 */

import { SosFilter, designButterworthBandpass } from '../../src/server/seedlink/iir.ts';
import { calculateTravelTime1D } from '../../src/server/seedlink/travel-time.ts';

export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/** Velocidad pico (m/s) de la onda S para una magnitud y una distancia hipocentral (km) */
export function peakVelocityMps(magnitude, hypocentralKm) {
  const logCmPerSec = -2.54 + 0.82 * magnitude - 1.45 * Math.log10(Math.max(hypocentralKm, 1));
  return (10 ** logCmPerSec) / 100;
}

/** Ruido gaussiano de banda ancha (0.4 - 20 Hz) con la desviación estándar pedida en m/s */
export function backgroundVelocity(count, sampleRate, rmsMps, rng) {
  const hi = Math.min(20, sampleRate * 0.45);
  const filter = new SosFilter(designButterworthBandpass(2, sampleRate, 0.4, hi));
  const out = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    out[i] = filter.process(gaussian(rng));
    sum += out[i] * out[i];
  }
  const rms = Math.sqrt(sum / count) || 1;
  const scale = rmsMps / rms;
  for (let i = 0; i < count; i++) out[i] *= scale;
  return out;
}

function carrier(count, sampleRate, centerHz, rng) {
  const filter = new SosFilter(designButterworthBandpass(2, sampleRate, centerHz * 0.5, Math.min(centerHz * 2.5, sampleRate * 0.45)));
  const out = new Float64Array(count);
  let peak = 0;
  for (let i = 0; i < count; i++) {
    out[i] = filter.process(gaussian(rng));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < count; i++) out[i] /= peak || 1;
  return out;
}

/**
 * Suma a `velocity` (m/s) un sismo local. Devuelve los tiempos de llegada P y S (ms).
 * @param {Float64Array} velocity
 * @param {{ startMs: number, sampleRate: number, originMs: number, epicentralKm: number, depthKm: number, magnitude: number, rng: () => number }} o
 */
export function addEarthquake(velocity, o) {
  const { startMs, sampleRate, originMs, epicentralKm, depthKm, magnitude, rng } = o;
  const hypo = Math.hypot(epicentralKm, depthKm);
  const tP = originMs + calculateTravelTime1D(epicentralKm, depthKm, 'P') * 1000;
  const tS = originMs + calculateTravelTime1D(epicentralKm, depthKm, 'S') * 1000;
  const ampS = peakVelocityMps(magnitude, hypo);
  const ampP = ampS / 2.5;
  const fc = Math.max(1.5, 10 ** (1.9 - 0.3 * magnitude) * 1.5);
  const carrierP = carrier(velocity.length, sampleRate, Math.min(fc * 1.2, 8), rng);
  const carrierS = carrier(velocity.length, sampleRate, Math.min(fc, 5), rng);
  const tau = 4 + 3 * Math.max(0, magnitude - 2) + hypo / 40;
  for (let i = 0; i < velocity.length; i++) {
    const t = startMs + (i * 1000) / sampleRate;
    if (t >= tP) {
      const dt = (t - tP) / 1000;
      const rise = Math.min(1, dt / 0.25);
      const decay = Math.exp(-Math.max(0, dt - 1.0) / (tau * 0.5));
      velocity[i] += ampP * rise * decay * carrierP[i];
    }
    if (t >= tS) {
      const dt = (t - tS) / 1000;
      const rise = Math.min(1, dt / 0.4);
      velocity[i] += ampS * rise * Math.exp(-dt / tau) * carrierS[i];
    }
  }
  return { tP, tS, ampS, ampP };
}

/** Convierte velocidad (m/s) a cuentas enteras con la sensibilidad (cuentas por m/s) y un desplazamiento de continua */
export function toCounts(velocity, sensitivity, dcOffset = 0) {
  const out = new Int32Array(velocity.length);
  for (let i = 0; i < velocity.length; i++) out[i] = Math.round(velocity[i] * sensitivity + dcOffset);
  return out;
}
