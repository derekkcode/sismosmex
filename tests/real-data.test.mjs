import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleKm } from '../src/server/seedlink/gq-geo.ts';
import { loadFixture, replayFixture } from './helpers/real-data.mjs';

// Sismo real M3.3 (ml) al ESE de Maneadero, B.C., a 16 km de BC.VTX, con registros de la red BC (CICESE)
const quake = loadFixture('bc-near-station-2022-12-27.json.gz');
const origin = quake.event;

function quiet(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
}

function errorKm(event) {
  return greatCircleKm(origin.lat, origin.lon, event.latitude, event.longitude);
}

test('a real M3.3 next to a station is detected within seconds, located and confirmed by the network', (t) => {
  quiet(t);
  const { detector, emitted } = replayFixture(quake);
  assert.ok(emitted.length > 0, 'the earthquake was not detected');

  const first = emitted[0];
  assert.ok(first.atMs - origin.originTimeMs < 30_000, `declared ${(first.atMs - origin.originTimeMs) / 1000} s after the origin`);
  assert.ok(errorKm(first.event) < 15, `first location ${errorKm(first.event).toFixed(1)} km away`);

  const last = emitted.at(-1).event;
  assert.equal(last.status, 'CONFIRMED');
  assert.ok(['NETWORK', 'S_WAVE'].includes(last.confirmationBasis));
  assert.ok(errorKm(last) < 15, `final location ${errorKm(last).toFixed(1)} km away`);
  assert.ok(Math.abs(last.timeEpoch - origin.originTimeMs) < 3000, 'origin time');
  assert.ok(last.stationCount >= 5);
  assert.ok(last.magnitude >= 2.8 && last.magnitude <= 3.8, `magnitude ${last.magnitude} for a catalog ML ${origin.magnitude}`);
  assert.ok(last.stations.some((s) => s.station === 'VTX' && s.sWaveArrived), 'the S wave is observed at the nearest station');
  assert.equal(detector.getEarthquakeHistory().length, 1);
});

test('the same real earthquake is still located and confirmed with only four nearby stations', (t) => {
  quiet(t);
  const { emitted } = replayFixture(quake, { stationCodes: ['VTX', 'SJX', 'CCX', 'CPX'] });
  assert.ok(emitted.length > 0, 'the earthquake was not detected');
  assert.ok(emitted[0].atMs - origin.originTimeMs < 30_000);

  const last = emitted.at(-1).event;
  assert.ok(errorKm(last) < 15);
  assert.equal(last.status, 'CONFIRMED');
  assert.equal(last.confirmationBasis, 'S_WAVE');
});

test('three real stations only raise a candidate, never a located earthquake', (t) => {
  quiet(t);
  const { emitted, candidates } = replayFixture(quake, { stationCodes: ['VTX', 'SJX', 'CCX'] });
  assert.equal(emitted.length, 0);
  const candidate = candidates.find((c) => c.candidate)?.candidate;
  assert.ok(candidate, 'the coherent group was not shown as a candidate');
  assert.deepEqual(candidate.stations, ['BC.CCX', 'BC.SJX', 'BC.VTX']);
});

test('an earthquake seen by only the two nearest real stations is registered once the SSN reports it', (t) => {
  quiet(t);
  const ssn = {
    id: 'eq-ssn-real-1', displayId: 'SSN001', time: new Date(origin.originTimeMs + 1000).toISOString(),
    timeEpoch: origin.originTimeMs + 1000, detectedAt: new Date(origin.originTimeMs + 1000).toISOString(),
    latitude: origin.lat + 0.04, longitude: origin.lon - 0.03, depth: 10, magnitude: 3.3, magnitudeType: 'M',
    location: '60 km al SUR de MEXICALI, BC', maxPga: 0, maxIntensity: 0, stationCount: 0, stations: [],
    category: 'ssn', status: 'CONFIRMED', source: 'SSN (Servicio Sismológico Nacional)',
  };
  const stationCodes = ['VTX', 'SJX'];

  const before = replayFixture(quake, { stationCodes });
  assert.equal(before.emitted.length, 0, 'two stations cannot locate an earthquake by themselves');

  const { detector, emitted } = replayFixture(quake, {
    stationCodes, ssn, ssnFromMs: origin.originTimeMs + 100_000, untilMs: origin.originTimeMs + 150_000,
  });
  const [event] = detector.getEarthquakeHistory();
  assert.ok(event, 'the SSN earthquake was not registered');
  assert.equal(emitted.length, 1);
  assert.equal(event.status, 'CONFIRMED');
  assert.equal(event.confirmationBasis, 'SSN');
  assert.deepEqual(event.stations.map((s) => s.station).sort(), ['SJX', 'VTX']);
  assert.ok(event.stations.every((s) => Math.abs(s.residualSec) < 3 && s.distanceKm > 0));
});

test('real daytime background noise on five noisy stations produces neither an earthquake nor a candidate', (t) => {
  quiet(t);
  const { emitted, candidates } = replayFixture(loadFixture('bc-background-2023-05-09.json.gz'));
  assert.equal(emitted.length, 0);
  assert.ok(candidates.every((c) => c.candidate === null));
});
