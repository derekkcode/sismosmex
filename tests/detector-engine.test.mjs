import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleKm } from '../src/server/seedlink/gq-geo.ts';
import { createEngineSimulation, nearestStations, START_MS } from './helpers/engine-simulation.mjs';

const SAN_MARCOS = { lat: 16.821, lon: -99.642, depthKm: 19.6 };
const MEXICALI = { lat: 32.386, lon: -115.535, depthKm: 10 };

function ssnEvent(place, originMs, magnitude, text = 'SSN') {
  return {
    id: `eq-ssn-${originMs}`,
    displayId: 'SSN001',
    time: new Date(originMs).toISOString(),
    timeEpoch: originMs,
    detectedAt: new Date(originMs).toISOString(),
    latitude: place.lat,
    longitude: place.lon,
    depth: place.depthKm,
    magnitude,
    magnitudeType: 'M',
    location: `27 km al OESTE de ${text}`,
    maxPga: 0,
    maxIntensity: 0,
    stationCount: 0,
    stations: [],
    category: 'ssn',
    status: 'CONFIRMED',
    source: 'SSN (Servicio Sismológico Nacional)',
  };
}

function quiet(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
}

test('a local earthquake is declared with its location and confirmed by the network or the S wave', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(SAN_MARCOS.lat, SAN_MARCOS.lon, 6, 200),
    quake: { magnitude: 3.8, depthKm: SAN_MARCOS.depthKm },
  });
  sim.run();

  assert.ok(sim.events.length > 0);
  const first = sim.events[0];
  assert.ok(first.stationCount >= 4);
  assert.ok(greatCircleKm(SAN_MARCOS.lat, SAN_MARCOS.lon, first.latitude, first.longitude) < 40);
  assert.ok(first.timeEpoch - sim.originMs < 5000 && sim.originMs - first.timeEpoch < 5000);

  const last = sim.events.at(-1);
  assert.equal(last.status, 'CONFIRMED');
  assert.ok(['NETWORK', 'S_WAVE'].includes(last.confirmationBasis));
  assert.ok(greatCircleKm(SAN_MARCOS.lat, SAN_MARCOS.lon, last.latitude, last.longitude) < 10);
  assert.ok(last.stations.every((s) => s.tP > 0 && s.eventId === last.id));
  assert.ok(Math.abs(last.timeEpoch - sim.originMs) < 3000);
  assert.ok(last.magnitude >= 3.0 && last.magnitude <= 4.6, `magnitude ${last.magnitude}`);

  const history = sim.detector.getEarthquakeHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, first.id);
});

test('a preliminary earthquake without physical evidence is not confirmed by the passage of time', (t) => {
  quiet(t);
  // Sin amplitudes no hay evidencia de onda S: solo queda la coincidencia de llegadas P de cuatro estaciones
  const sim = createEngineSimulation({
    stations: nearestStations(SAN_MARCOS.lat, SAN_MARCOS.lon, 4, 100),
    quake: { magnitude: 3.4, depthKm: SAN_MARCOS.depthKm },
    withholdAmplitudes: true,
  });
  sim.run();
  assert.ok(sim.events.length > 0);
  assert.ok(sim.events.every((e) => e.status === 'PRELIMINARY'));

  sim.idle(START_MS + 205_000, START_MS + 205_000 + 20 * 60_000, 5000);
  assert.ok(sim.events.every((e) => e.status === 'PRELIMINARY'));
});

test('three coherent stations are shown as a candidate, not as an earthquake, and the candidate clears itself', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(MEXICALI.lat, MEXICALI.lon, 3, 60),
    quake: { magnitude: 3.4, depthKm: MEXICALI.depthKm },
  });
  sim.run();
  assert.equal(sim.events.length, 0);
  const candidate = sim.candidates.find((c) => c !== null);
  assert.ok(candidate);
  assert.equal(candidate.stationCount, 3);
  assert.equal(candidate.stations.length, 3);
  assert.ok(!('latitude' in candidate) && !('magnitude' in candidate));

  sim.idle(START_MS + 205_000, START_MS + 205_000 + 4 * 60_000, 5000);
  assert.equal(sim.candidates.at(-1), null);
  assert.equal(sim.detector.getSeismicCandidate(), null);
});

test('the SSN confirms a preliminary earthquake with its official location and magnitude', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(SAN_MARCOS.lat, SAN_MARCOS.lon, 4, 100),
    quake: { magnitude: 3.4, depthKm: SAN_MARCOS.depthKm },
    withholdAmplitudes: true,
  });
  sim.run();
  const [event] = sim.detector.getEarthquakeHistory();
  assert.equal(event.status, 'PRELIMINARY');

  const ssn = ssnEvent({ lat: 16.82, lon: -99.64, depthKm: 19 }, sim.originMs + 400, 3.3, 'SAN MARCOS, GRO');
  sim.detector.reconcileWithSsn([ssn], sim.originMs + 5 * 60_000);

  const confirmed = sim.detector.getEarthquakeHistory()[0];
  assert.equal(sim.detector.getEarthquakeHistory().length, 1);
  assert.equal(confirmed.id, event.id);
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.confirmationBasis, 'SSN');
  assert.equal(confirmed.magnitude, 3.3);
  assert.equal(confirmed.latitude, 16.82);
  assert.equal(confirmed.isLocked, true);
  assert.equal(sim.events.at(-1).confirmationBasis, 'SSN');
});

test('an SSN earthquake seen only by the three nearest stations is registered as detected and confirmed', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(MEXICALI.lat, MEXICALI.lon, 3, 60),
    quake: { magnitude: 3.4, depthKm: MEXICALI.depthKm },
  });
  sim.run();
  assert.equal(sim.detector.getEarthquakeHistory().length, 0);

  const ssn = ssnEvent(MEXICALI, sim.originMs - 500, 3.4, 'SANTA ISABEL, BC');
  // Antes de que pasen unos 90 s no se decide: las estaciones aún pueden estar analizando
  sim.detector.reconcileWithSsn([ssn], sim.originMs + 60_000);
  assert.equal(sim.detector.getEarthquakeHistory().length, 0);
  sim.detector.reconcileWithSsn([ssn], sim.originMs + 5 * 60_000);

  const [event] = sim.detector.getEarthquakeHistory();
  assert.ok(event);
  assert.equal(event.status, 'CONFIRMED');
  assert.equal(event.confirmationBasis, 'SSN');
  assert.equal(event.stations.length, 3);
  assert.equal(event.magnitude, 3.4);
  assert.ok(event.stations.every((s) => Math.abs(s.residualSec) < 3));

  // Una segunda lectura del mismo catálogo no duplica el sismo
  sim.detector.reconcileWithSsn([ssn], sim.originMs + 6 * 60_000);
  assert.equal(sim.detector.getEarthquakeHistory().length, 1);
});

test('an SSN earthquake that the stations did not record at the predicted time is not attributed to them', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(MEXICALI.lat, MEXICALI.lon, 3, 60),
    quake: { magnitude: 3.4, depthKm: MEXICALI.depthKm },
  });
  sim.run();
  // El SSN reporta 40 s antes y 400 km al sur: ninguna llegada observada coincide con lo que predice
  sim.detector.reconcileWithSsn([ssnEvent({ lat: 28.5, lon: -114.0, depthKm: 10 }, sim.originMs - 40_000, 3.0)], sim.originMs + 5 * 60_000);
  sim.detector.reconcileWithSsn([ssnEvent(MEXICALI, sim.originMs - 40_000, 3.0)], sim.originMs + 5 * 60_000);
  assert.equal(sim.detector.getEarthquakeHistory().length, 0);
});

test('cancelling an earthquake removes it and its stations do not form it again', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(SAN_MARCOS.lat, SAN_MARCOS.lon, 6, 200),
    quake: { magnitude: 3.8, depthKm: SAN_MARCOS.depthKm },
    seconds: 220,
  });
  sim.run(0, 125);
  const [event] = sim.detector.getEarthquakeHistory();
  assert.ok(event);

  const result = sim.detector.cancelEarthquake(event.displayId);
  assert.equal(result.cancelled, true);
  assert.equal(sim.detector.getEarthquakeHistory().length, 0);
  const before = sim.events.length;
  sim.run(125, 220);
  assert.equal(sim.detector.getEarthquakeHistory().length, 0);
  assert.equal(sim.events.length, before);
});

test('a stream withdrawn by the reception control loses its open events but keeps the other channels', (t) => {
  quiet(t);
  const sim = createEngineSimulation({
    stations: nearestStations(SAN_MARCOS.lat, SAN_MARCOS.lon, 1, 100),
    quake: { magnitude: 3.8, depthKm: SAN_MARCOS.depthKm },
    seconds: 112,
  });
  sim.run(0, 108);
  const [station] = sim.detector.getPipeline().stations;
  const open = station.events.filter((e) => e.valid && !e.hasEnded());
  assert.ok(open.length > 0);

  sim.detector.clearStationTrigger(station.info.code, station.info.network, 'HNZ');
  assert.ok(open.every((e) => e.valid));
  sim.detector.clearStationTrigger(station.info.code, station.info.network, 'HHZ');
  assert.ok(open.every((e) => !e.valid));
});
