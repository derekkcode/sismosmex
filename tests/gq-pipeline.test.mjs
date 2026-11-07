import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GqPipeline } from '../src/server/seedlink/gq-pipeline.ts';
import { greatCircleKm } from '../src/server/seedlink/gq-geo.ts';
import { locateHypocenter } from '../src/server/seedlink/gq-hypocenter.ts';
import { calculateTravelTime1D } from '../src/server/seedlink/travel-time.ts';
import { addEarthquake, backgroundVelocity, createRng, gaussian, toCounts } from './helpers/synthetic-seismograms.mjs';

const catalog = JSON.parse(readFileSync(path.resolve('stations.json'), 'utf8')).filter((s) => s.work !== false);
const START_MS = Date.UTC(2026, 10, 7, 10, 0, 0);
const SAMPLE_RATE = 100;
const SENSITIVITY = 6e8;

function stationsAround(lat, lon, count, maxKm = 400) {
  return catalog
    .map((s) => ({ s, distKm: greatCircleKm(lat, lon, s.lat, s.lon) }))
    .filter((x) => x.distKm <= maxKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, count)
    .map(({ s, distKm }) => ({
      info: { network: s.network, code: s.code, lat: s.lat, lon: s.lon, elevationM: s.alt || 0 },
      distKm,
    }));
}

/** Alimenta un canal vertical sintético por estación, paquetes de 1 s, y ejecuta el canal cada segundo */
function simulate({ stations, quake, seconds = 170, originSec = 100, seed = 5, noiseMicrons = 0.3, perStationOrigin }) {
  const rng = createRng(seed);
  const pipeline = new GqPipeline();
  const traces = stations.map(({ info, distKm }, index) => {
    const velocity = backgroundVelocity(seconds * SAMPLE_RATE, SAMPLE_RATE, noiseMicrons * 1e-6, rng);
    if (quake || perStationOrigin) {
      addEarthquake(velocity, {
        startMs: START_MS,
        sampleRate: SAMPLE_RATE,
        originMs: START_MS + (perStationOrigin ? perStationOrigin[index] : originSec) * 1000,
        epicentralKm: perStationOrigin ? 20 : distKm,
        depthKm: quake?.depthKm ?? 10,
        magnitude: quake?.magnitude ?? 3.4,
        rng,
      });
    }
    return { info, counts: toCounts(velocity, SENSITIVITY, 500) };
  });
  const changes = [];
  for (let k = 0; k < seconds; k++) {
    for (const trace of traces) {
      pipeline.ingest(trace.info, 'HHZ', trace.counts.subarray(k * SAMPLE_RATE, (k + 1) * SAMPLE_RATE), START_MS + k * 1000, SAMPLE_RATE);
    }
    const nowMs = START_MS + (k + 1) * 1000 + 2000;
    for (const change of pipeline.run(nowMs)) changes.push({ ...change, atSec: k + 1 + 2 });
  }
  return { pipeline, changes, endMs: START_MS + seconds * 1000 };
}

const SAN_MARCOS = { lat: 16.821, lon: -99.642, depthKm: 19.6 };

test('the locator finds a local epicenter within a few km using real station geometry', () => {
  const rng = createRng(21);
  const origin = START_MS;
  const near = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 8, 250);
  const picks = near.map(({ info, distKm }) => ({
    key: `${info.network}.${info.code}`,
    pWaveMs: origin + calculateTravelTime1D(distKm, SAN_MARCOS.depthKm, 'P') * 1000 + gaussian(rng) * 250 + info.elevationM / 6,
    lat: info.lat, lon: info.lon, elevationM: info.elevationM, maxRatio: 30,
  }));
  const solution = locateHypocenter(picks);
  assert.ok(solution);
  assert.ok(greatCircleKm(SAN_MARCOS.lat, SAN_MARCOS.lon, solution.lat, solution.lon) < 5);
  assert.equal(solution.correctEvents, 8);
  assert.ok(Math.abs(solution.originMs - origin) < 1500);
  assert.ok(Math.abs(solution.depthKm - SAN_MARCOS.depthKm) < 25);
});

test('an inconsistent arrival is left out of the correct set without dragging the epicenter', () => {
  const rng = createRng(22);
  const near = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 8, 250);
  const picks = near.map(({ info, distKm }, i) => ({
    key: `${info.network}.${info.code}`,
    pWaveMs: START_MS + calculateTravelTime1D(distKm, SAN_MARCOS.depthKm, 'P') * 1000 + gaussian(rng) * 200 + (i === 3 ? 7000 : 0),
    lat: info.lat, lon: info.lon, elevationM: 0, maxRatio: 30,
  }));
  const solution = locateHypocenter(picks);
  assert.ok(solution);
  assert.equal(solution.correctEvents, 7);
  assert.ok(!solution.correctKeys.includes(picks[3].key));
  assert.ok(greatCircleKm(SAN_MARCOS.lat, SAN_MARCOS.lon, solution.lat, solution.lon) < 6);
});

test('with fewer than three arrivals there is nothing to locate, and few stations keep a shallow depth', () => {
  const near = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 4, 250);
  const picks = near.map(({ info, distKm }) => ({
    key: info.code,
    pWaveMs: START_MS + calculateTravelTime1D(distKm, 40, 'P') * 1000,
    lat: info.lat, lon: info.lon, elevationM: 0, maxRatio: 30,
  }));
  assert.equal(locateHypocenter(picks.slice(0, 2)), null);
  const solution = locateHypocenter(picks);
  assert.ok(solution);
  assert.equal(solution.depthFixed, true);
  assert.equal(solution.depthKm, 10);
});

test('a small earthquake next to a station is declared from four nearby stations', () => {
  const stations = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 4, 100);
  assert.equal(stations.length, 4);
  const { changes, pipeline } = simulate({ stations, quake: { magnitude: 3.4, depthKm: SAN_MARCOS.depthKm } });
  const created = changes.filter((c) => c.type === 'created');
  assert.equal(created.length, 1);
  const quake = created[0].quake;
  assert.ok(greatCircleKm(SAN_MARCOS.lat, SAN_MARCOS.lon, quake.lat, quake.lon) < 8);
  assert.ok(quake.hypocenter.correctEvents >= 4);
  assert.ok(created[0].atSec - 100 < 30, `declared ${created[0].atSec - 100} s after the origin`);
  assert.equal(pipeline.quakes.length, 1);
  assert.equal(pipeline.clusters.length, 1);
});

test('three coherent stations remain a candidate and never become a located earthquake', () => {
  const stations = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 3, 100);
  const { changes, pipeline, endMs } = simulate({ stations, quake: { magnitude: 3.4, depthKm: SAN_MARCOS.depthKm } });
  assert.equal(changes.filter((c) => c.type === 'created').length, 0);
  assert.equal(pipeline.quakes.length, 0);
  const candidates = pipeline.candidates(3, endMs - 40_000);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].stations.length, 3);
});

test('triggers whose arrival times cannot come from one source do not form a group', () => {
  const stations = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 5, 150);
  const { pipeline, changes, endMs } = simulate({ stations, perStationOrigin: [60, 95, 80, 118, 40] });
  assert.equal(changes.filter((c) => c.type === 'created').length, 0);
  assert.equal(pipeline.quakes.length, 0);
  assert.equal(pipeline.candidates(3, endMs - 40_000).length, 0);
});

test('background noise on ten stations for ten minutes forms no group at all', () => {
  const stations = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 10, 400);
  const { pipeline, changes } = simulate({ stations, seconds: 600, seed: 31 });
  assert.equal(changes.length, 0);
  assert.equal(pipeline.clusters.length, 0);
});

test('later S waves do not start a second group and a rejected earthquake does not come back', () => {
  const stations = stationsAround(SAN_MARCOS.lat, SAN_MARCOS.lon, 8, 200);
  const { pipeline } = simulate({ stations, quake: { magnitude: 3.8, depthKm: SAN_MARCOS.depthKm }, seconds: 200 });
  assert.equal(pipeline.quakes.length, 1);
  assert.equal(pipeline.clusters.length, 1);

  const [quake] = pipeline.quakes;
  pipeline.rejectQuake(quake);
  for (let k = 0; k < 20; k++) pipeline.run(START_MS + 205_000 + k * 1000);
  assert.equal(pipeline.quakes.length, 0);
  assert.equal(pipeline.clusters.length, 0);
});
