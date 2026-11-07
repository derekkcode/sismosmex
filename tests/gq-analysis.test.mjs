import test from 'node:test';
import assert from 'node:assert/strict';
import { biquadMagnitude, designButterworthBandpass, SosFilter } from '../src/server/seedlink/iir.ts';
import { GqStationAnalysis } from '../src/server/seedlink/gq-analysis.ts';
import { addEarthquake, backgroundVelocity, createRng, toCounts } from './helpers/synthetic-seismograms.mjs';

const SENSITIVITY = 6e8;
const START_MS = Date.UTC(2026, 10, 7, 10, 0, 0);

function synthesize({ seconds, sampleRate = 100, originSec, epicentralKm = 40, depthKm = 10, magnitude = 3.4, noiseMicrons = 0.3, seed = 3 }) {
  const rng = createRng(seed);
  const velocity = backgroundVelocity(seconds * sampleRate, sampleRate, noiseMicrons * 1e-6, rng);
  const arrivals = originSec === undefined
    ? null
    : addEarthquake(velocity, {
      startMs: START_MS, sampleRate, originMs: START_MS + originSec * 1000, epicentralKm, depthKm, magnitude, rng,
    });
  return { counts: toCounts(velocity, SENSITIVITY, 700), arrivals, sampleRate };
}

function feed(analysis, counts, sampleRate, packetSamples) {
  for (let i = 0; i < counts.length; i += packetSamples) {
    analysis.analyse(counts.subarray(i, i + packetSamples), START_MS + (i * 1000) / sampleRate, sampleRate);
  }
}

test('the band-pass filter has unit gain at its center and -3 dB at both corners', () => {
  for (const sampleRate of [20, 40, 100]) {
    const sections = designButterworthBandpass(3, sampleRate, 2, 5);
    assert.equal(sections.length, 3);
    const gainDb = (hz) => 20 * Math.log10(sections.reduce((g, s) => g * biquadMagnitude(s, (2 * Math.PI * hz) / sampleRate), 1));
    assert.ok(Math.abs(gainDb(Math.sqrt(10))) < 0.01);
    assert.ok(Math.abs(gainDb(2) + 3.01) < 0.05);
    assert.ok(Math.abs(gainDb(5) + 3.01) < 0.05);
    assert.ok(gainDb(0.5) < -35);
  }
  const filter = new SosFilter(designButterworthBandpass(3, 100, 2, 5));
  let peak = 0;
  for (let i = 0; i < 2000; i++) {
    const y = filter.process(Math.sin((2 * Math.PI * 3.2 * i) / 100));
    if (i > 1000) peak = Math.max(peak, Math.abs(y));
  }
  assert.ok(peak > 0.98 && peak < 1.02);
});

test('a local arrival opens one event whose P pick is close to the true onset', () => {
  const { counts, arrivals, sampleRate } = synthesize({ seconds: 160, originSec: 100 });
  const analysis = new GqStationAnalysis();
  feed(analysis, counts, sampleRate, 100);

  const events = analysis.events.filter((e) => e.valid);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.ok(event.maxRatio >= 16, `ratio ${event.maxRatio}`);
  assert.ok(event.startMs >= arrivals.tP && event.startMs - arrivals.tP < 1500);
  assert.ok(event.pWaveMs > 0);
  assert.ok(Math.abs(event.pWaveMs - arrivals.tP) <= 1500, `pick error ${(event.pWaveMs - arrivals.tP) / 1000} s`);
});

test('ten minutes of background noise do not open events', () => {
  const { counts, sampleRate } = synthesize({ seconds: 600 });
  const analysis = new GqStationAnalysis();
  feed(analysis, counts, sampleRate, 100);
  assert.equal(analysis.events.length, 0);
  assert.equal(analysis.status, 'IDLE');
});

test('the same onset is found whatever the packet size', () => {
  const { counts, arrivals, sampleRate } = synthesize({ seconds: 160, originSec: 100, seed: 9 });
  const starts = [];
  const picks = [];
  for (const packetSamples of [10, 37, 100, 512]) {
    const analysis = new GqStationAnalysis();
    feed(analysis, counts, sampleRate, packetSamples);
    const event = analysis.events.find((e) => e.valid);
    assert.ok(event, `packet size ${packetSamples}`);
    starts.push(event.startMs);
    picks.push(event.pWaveMs);
  }
  assert.ok(Math.max(...starts) - Math.min(...starts) <= 20);
  assert.ok(Math.max(...picks) - Math.min(...picks) <= 100);
  assert.ok(Math.abs(picks[0] - arrivals.tP) <= 1500);
});

test('a short gap keeps the background level and a long gap re-initializes the analysis', () => {
  const { counts, sampleRate } = synthesize({ seconds: 200 });
  const analysis = new GqStationAnalysis();
  feed(analysis, counts.subarray(0, 60 * sampleRate), sampleRate, 100);
  assert.equal(analysis.status, 'IDLE');

  // Hueco de 8 s: el filtro se reinicia pero el análisis sigue operativo sin esperar la inicialización completa
  const afterShortGap = START_MS + 68_000;
  analysis.analyse(counts.subarray(68 * sampleRate, 69 * sampleRate), afterShortGap, sampleRate);
  assert.equal(analysis.status, 'IDLE');

  // Hueco de 3 minutos: vuelve a inicializar
  analysis.analyse(counts.subarray(70 * sampleRate, 71 * sampleRate), START_MS + 260_000, sampleRate);
  assert.equal(analysis.status, 'INIT');
});

test('an event interrupted by a gap is discarded instead of being kept open', () => {
  const { counts, arrivals, sampleRate } = synthesize({ seconds: 160, originSec: 100 });
  const analysis = new GqStationAnalysis();
  const cut = Math.round(((arrivals.tP - START_MS) / 1000 + 3) * sampleRate);
  feed(analysis, counts.subarray(0, cut), sampleRate, 100);
  assert.equal(analysis.status, 'EVENT');
  analysis.analyse(counts.subarray(cut, cut + 100), START_MS + (cut * 1000) / sampleRate + 6000, sampleRate);
  assert.ok(analysis.events.every((e) => !e.valid || e.hasEnded()));
  assert.notEqual(analysis.status, 'EVENT');
});
