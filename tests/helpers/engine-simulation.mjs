/**
 * SIMULADOR DEL CAMINO COMPLETO DE UN PAQUETE: DSP -> DETECTOR
 *
 * Reproduce lo que hace SeedLinkService con cada paquete (procesa las muestras con el DSP y entrega la telemetría
 * junto con las muestras al detector) y ejecuta el ciclo del detector una vez por segundo, con relojes controlados.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SeismicDetectorEngine } from '../../src/server/seedlink/detector.ts';
import { SeismicDspEngine } from '../../src/server/seedlink/seismic-dsp.ts';
import { NoiseCalibrator } from '../../src/server/seedlink/noise-calibrator.ts';
import { greatCircleKm } from '../../src/server/seedlink/gq-geo.ts';
import { addEarthquake, backgroundVelocity, createRng, toCounts } from './synthetic-seismograms.mjs';

export const START_MS = Date.UTC(2026, 10, 7, 10, 0, 0);
export const SAMPLE_RATE = 100;

let catalogCache = null;
export function stationCatalog() {
  if (!catalogCache) {
    catalogCache = JSON.parse(readFileSync(path.resolve('stations.json'), 'utf8')).filter((s) => s.work !== false);
  }
  return catalogCache;
}

export function nearestStations(lat, lon, count, maxKm = 400) {
  return stationCatalog()
    .map((s) => ({ s, distKm: greatCircleKm(lat, lon, s.lat, s.lon) }))
    .filter((x) => x.distKm <= maxKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, count);
}

/**
 * @param {{ stations: Array<{s: any, distKm: number}>, quake?: {magnitude: number, depthKm: number}, seconds?: number,
 *           originSec?: number, seed?: number, noiseMicrons?: number, minPgaThreshold?: number }} o
 */
export function createEngineSimulation(o) {
  const { stations, quake, seconds = 200, originSec = 100, seed = 11, noiseMicrons = 0.3, minPgaThreshold, withholdAmplitudes = false } = o;
  const rng = createRng(seed);
  const detector = SeismicDetectorEngine.createDetached();
  const events = [];
  const cancelled = [];
  const candidates = [];
  detector.setOnEventDetected((event) => events.push(structuredClone(event)));
  detector.setOnEventCancelled((event, reason) => cancelled.push({ event, reason }));
  detector.setOnCandidateChanged((candidate) => candidates.push(candidate));

  const dsp = new SeismicDspEngine({ noiseCalibrator: new NoiseCalibrator({ persist: false }) });
  const originMs = START_MS + originSec * 1000;
  const traces = stations.map(({ s, distKm }) => {
    const velocity = backgroundVelocity(seconds * SAMPLE_RATE, SAMPLE_RATE, noiseMicrons * 1e-6, rng);
    if (quake) {
      addEarthquake(velocity, {
        startMs: START_MS, sampleRate: SAMPLE_RATE, originMs, epicentralKm: distKm,
        depthKm: quake.depthKm, magnitude: quake.magnitude, rng,
      });
    }
    const meta = s.channels.find((c) => c.code === 'HHZ') ?? s.channels[0];
    return { s, meta, counts: toCounts(velocity, meta.sensitivity || 6e8, 500) };
  });

  const realNow = Date.now;
  const sim = {
    detector, events, cancelled, candidates, originMs, seconds,
    /** Entrega el segundo `k` de datos de todas las estaciones y ejecuta un ciclo del detector */
    step(k) {
      const startMs = START_MS + k * 1000;
      for (const trace of traces) {
        const samples = trace.counts.subarray(k * SAMPLE_RATE, (k + 1) * SAMPLE_RATE);
        const processed = dsp.processSamples(trace.s.network, trace.s.code, 'HHZ', SAMPLE_RATE, new Date(startMs).toISOString(), samples, trace.meta);
        // Sin amplitudes el detector solo cuenta con las muestras para las llegadas P: no hay evidencia de onda S ni de PGA
        const amplitudes = withholdAmplitudes
          ? { pga: 0, amp: 0, woodAndersonDispMm: 0 }
          : { pga: processed.pga, amp: processed.amplitudePhysical, woodAndersonDispMm: processed.woodAndersonDispMm };
        detector.processStationTelemetry({
          station: trace.s.code, network: trace.s.network, channel: 'HHZ', lat: trace.s.lat, lon: trace.s.lon, alt: trace.s.alt,
          site: trace.s.site, stateName: trace.s.state, pga: amplitudes.pga, amp: amplitudes.amp,
          sampleRate: SAMPLE_RATE, packetStartTime: processed.startTime, samples,
          woodAndersonDispMm: amplitudes.woodAndersonDispMm,
          minPgaThreshold: minPgaThreshold ?? processed.staLta.minPgaGal, noiseClass: processed.noise.noiseClass,
        });
      }
      Date.now = () => startMs + 3000;
      try {
        detector.tick(startMs + 3000);
      } finally {
        Date.now = realNow;
      }
    },
    run(fromSec = 0, toSec = seconds) {
      for (let k = fromSec; k < toSec; k++) sim.step(k);
    },
    /** Ciclos del detector sin datos nuevos (para comprobar que el tiempo por sí solo no cambia nada) */
    idle(fromMs, toMs, stepMs = 1000) {
      for (let t = fromMs; t <= toMs; t += stepMs) {
        Date.now = () => t;
        try {
          detector.tick(t);
        } finally {
          Date.now = realNow;
        }
      }
    },
  };
  return sim;
}
