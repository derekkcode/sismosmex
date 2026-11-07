/**
 * REPRODUCCIÓN DE REGISTROS SÍSMICOS REALES A TRAVÉS DEL CAMINO COMPLETO: DSP -> DETECTOR
 *
 * Los registros (tests/fixtures) son cuentas crudas de la componente vertical de la red BC (CICESE) con la sensibilidad
 * real de cada canal. Se entregan en paquetes de 1 s, como SeedLink, y el detector corre un ciclo por segundo con relojes
 * controlados (latencia de 2 s respecto al final de cada paquete).
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SeismicDetectorEngine } from '../../src/server/seedlink/detector.ts';
import { SeismicDspEngine } from '../../src/server/seedlink/seismic-dsp.ts';
import { NoiseCalibrator } from '../../src/server/seedlink/noise-calibrator.ts';

export function loadFixture(name) {
  const raw = gunzipSync(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));
  const fixture = JSON.parse(raw.toString('utf8'));
  for (const station of fixture.stations) {
    const samples = new Int32Array(station.deltas.length);
    let acc = 0;
    station.deltas.forEach((d, i) => {
      acc += d;
      samples[i] = acc;
    });
    station.samples = samples;
  }
  return fixture;
}

/**
 * @param {ReturnType<typeof loadFixture>} fixture
 * @param {{ stationCodes?: string[], ssn?: object, ssnFromMs?: number, untilMs?: number }} [options]
 *   `untilMs`: el detector sigue corriendo ciclos sin datos nuevos hasta ese instante (los registros recortados terminan antes)
 */
export function replayFixture(fixture, options = {}) {
  const { stationCodes, ssn, ssnFromMs = 0, untilMs = 0 } = options;
  const stations = fixture.stations.filter((s) => !stationCodes || stationCodes.includes(s.station));
  const realNow = Date.now;
  const detector = SeismicDetectorEngine.createDetached();
  const dsp = new SeismicDspEngine({ noiseCalibrator: new NoiseCalibrator({ persist: false }) });
  const emitted = [];
  const candidates = [];
  let dataMs = 0;
  detector.setOnEventDetected((event) => emitted.push({ atMs: dataMs, event: structuredClone(event) }));
  detector.setOnCandidateChanged((candidate) => candidates.push({ atMs: dataMs, candidate }));

  const packets = [];
  for (const st of stations) {
    const perPacket = Math.round(st.sampleRate);
    for (let i = 0; i + perPacket <= st.samples.length; i += perPacket) {
      packets.push({ t: st.startMs + (i * 1000) / st.sampleRate, st, samples: st.samples.subarray(i, i + perPacket) });
    }
  }
  packets.sort((a, b) => a.t - b.t);

  const withClock = (nowMs, fn) => {
    Date.now = () => nowMs;
    try {
      fn();
    } finally {
      Date.now = realNow;
    }
  };

  let nextTickMs = packets.length ? packets[0].t + 1000 : 0;
  const tick = (t) => {
    dataMs = t;
    withClock(t + 2000, () => {
      detector.tick(t + 2000);
      if (ssn && t >= ssnFromMs) detector.reconcileWithSsn([ssn], t + 2000);
    });
  };
  for (const p of packets) {
    while (p.t >= nextTickMs) {
      tick(nextTickMs);
      nextTickMs += 1000;
    }
    withClock(p.t + 1000, () => {
      const meta = { code: p.st.channel, sensitivity: p.st.sensitivity };
      const processed = dsp.processSamples(p.st.network, p.st.station, p.st.channel, p.st.sampleRate, new Date(p.t).toISOString(), p.samples, meta);
      detector.processStationTelemetry({
        station: p.st.station, network: p.st.network, channel: p.st.channel, lat: p.st.lat, lon: p.st.lon, alt: p.st.elevationM,
        site: p.st.station, stateName: 'BC', pga: processed.pga, amp: processed.amplitudePhysical,
        sampleRate: p.st.sampleRate, packetStartTime: processed.startTime, samples: p.samples,
        woodAndersonDispMm: processed.woodAndersonDispMm,
        minPgaThreshold: processed.staLta.minPgaGal, noiseClass: processed.noise.noiseClass,
      });
    });
  }
  tick(nextTickMs);
  for (nextTickMs += 1000; nextTickMs <= untilMs; nextTickMs += 1000) tick(nextTickMs);
  return { detector, emitted, candidates };
}
