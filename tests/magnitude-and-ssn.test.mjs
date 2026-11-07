import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMagnitude, independentSites, localMagnitudeFromWoodAnderson, markSWaveArrivals, sWaveWindowMs } from '../src/server/seedlink/magnitude.ts';
import {
  isPickConsistent,
  matchDetectedEvent,
  pickResidualSec,
  pickToleranceSec,
} from '../src/server/seedlink/ssn-confirmation.ts';
import { calculateTravelTime1D } from '../src/server/seedlink/travel-time.ts';
import { greatCircleKm } from '../src/server/seedlink/gq-geo.ts';

function record(overrides = {}) {
  return {
    station: 'AAA', network: 'IG', channel: 'HHZ', lat: 16, lon: -99, site: '', stateName: '',
    tP: 1_000_000, tP_iso: '', staLtaRatio: 50, maxPga: 0.5, maxAmp: 1, woodAndersonAmpMm: 0, reqPga: 0.03,
    ...overrides,
  };
}

test('stations less than 3.5 km apart count as one independent site', () => {
  const a = record({ station: 'A', tP: 5 });
  const b = record({ station: 'B', lat: 16.01, tP: 3 });
  const c = record({ station: 'C', lat: 16.5, tP: 4 });
  assert.deepEqual(independentSites([a, b, c]).map((s) => s.station), ['B', 'C']);
});

test('the S wave needs the record peak inside its expected window and above the station noise, not only the passage of time', () => {
  const origin = 2_000_000;
  const station = record({ lat: 16.3, lon: -99, tP: 0, maxPga: 0.8, noisePga: 0.01 });
  const dist = greatCircleKm(16, -99, station.lat, station.lon);
  station.tP = origin + calculateTravelTime1D(dist, 10, 'P') * 1000;

  // Sin pico registrado en la ventana de la S no hay llegada, por más tiempo que pase
  assert.equal(markSWaveArrivals([station], 16, -99, 10, station.tP + 120_000), 0);
  assert.equal(station.sWaveArrived, false);

  station.sWindowPga = 0.8;
  const window = sWaveWindowMs(station);
  assert.ok(window.startMs < station.sWaveExpectedMs && window.endMs > station.sWaveExpectedMs);
  assert.equal(markSWaveArrivals([station], 16, -99, 10, window.endMs - 1000), 0, 'the window is still open');
  assert.equal(markSWaveArrivals([station], 16, -99, 10, window.endMs + 1000), 1);
  assert.equal(station.sWaveArrived, true);
  assert.ok(station.tS > 0);

  // Un pico mayor fuera de la ventana (otra fase o una ráfaga de ruido) no prueba la onda S
  station.maxPga = 2.0;
  assert.equal(markSWaveArrivals([station], 16, -99, 10, window.endMs + 1000), 0);
  // Tampoco un pico que no supera con claridad el ruido propio de la estación
  station.maxPga = 0.8;
  station.noisePga = 0.5;
  assert.equal(markSWaveArrivals([station], 16, -99, 10, window.endMs + 1000), 0);
});

test('the station magnitude follows Hutton & Boore from the Wood-Anderson amplitude and uses PGA only as a fallback', () => {
  // Valores medidos en BC.SJX (136 km) del sismo de Niland, CA, de 2023: 2.32 mm de amplitud Wood-Anderson
  assert.ok(Math.abs(localMagnitudeFromWoodAnderson(2.32, 136) - 3.58) < 0.02);
  assert.ok(localMagnitudeFromWoodAnderson(20, 100) > localMagnitudeFromWoodAnderson(2, 100));

  const withWa = record({ station: 'WA', lat: 16.5, maxPga: 0.01, woodAndersonAmpMm: 8 });
  const [lat, lon] = [16, -99];
  const dist = greatCircleKm(lat, lon, withWa.lat, withWa.lon);
  const estimate = estimateMagnitude([withWa], lat, lon, 10, 3_000_000);
  assert.equal(estimate.magnitude, Number(localMagnitudeFromWoodAnderson(8, Math.hypot(dist, 10)).toFixed(1)));

  // Sin ninguna medida la estación no aporta
  const empty = record({ station: 'EMPTY', lat: 16.5, maxPga: 0, woodAndersonAmpMm: 0 });
  assert.equal(estimateMagnitude([empty], lat, lon, 10, 3_000_000).validStationCount, 0);
});

test('the magnitude is the median of nearby stations and ignores far or weak citizen stations', () => {
  const stations = [
    record({ station: 'N1', lat: 16.1, maxPga: 4 }),
    record({ station: 'N2', lat: 16.2, maxPga: 2 }),
    record({ station: 'N3', lat: 16.3, maxPga: 1 }),
    record({ station: 'FAR', lat: 20, maxPga: 5 }),
    record({ station: 'RS', network: 'AM', lat: 16.1, maxPga: 0.2 }),
  ];
  const estimate = estimateMagnitude(stations, 16, -99, 10, 3_000_000);
  assert.equal(estimate.validStationCount, 3);
  assert.ok(estimate.magnitude > 2 && estimate.magnitude < 6);
  assert.equal(estimate.maxPga, 4);
  assert.equal(stations[3].stationML, undefined);
  assert.equal(stations[4].stationML, undefined);
  assert.ok(estimate.maxIntensity >= 1);
});

test('an external hypocenter is compared with arrivals through the regional travel-time model', () => {
  const hypo = { timeEpoch: 10_000_000, latitude: 32.4, longitude: -115.5, depth: 10 };
  const station = { lat: 32.135, lon: -115.28, elevationM: 16 };
  const dist = greatCircleKm(hypo.latitude, hypo.longitude, station.lat, station.lon);
  const exact = hypo.timeEpoch + (calculateTravelTime1D(dist, 10, 'P') + 16 / 6000) * 1000;

  assert.ok(Math.abs(pickResidualSec(hypo, { ...station, tP: exact })) < 0.01);
  assert.ok(isPickConsistent(hypo, { ...station, tP: exact + 2000 }));
  assert.ok(!isPickConsistent(hypo, { ...station, tP: exact + 6000 }));
  assert.ok(!isPickConsistent(hypo, { ...station, tP: exact - 6000 }));
  assert.ok(pickToleranceSec(60) > pickToleranceSec(5));
});

test('a detected earthquake matches an external one only when the origin and most arrivals agree', () => {
  const hypo = { timeEpoch: 10_000_000, latitude: 16.8, longitude: -99.6, depth: 15 };
  const stations = [[16.9, -99.5], [16.5, -99.9], [17.1, -99.2], [16.4, -99.3]];
  const picks = stations.map(([lat, lon]) => {
    const dist = greatCircleKm(hypo.latitude, hypo.longitude, lat, lon);
    return { lat, lon, elevationM: 0, tP: hypo.timeEpoch + calculateTravelTime1D(dist, 15, 'P') * 1000 };
  });

  assert.ok(matchDetectedEvent(hypo, { timeEpoch: hypo.timeEpoch + 3000 }, picks));
  assert.equal(matchDetectedEvent(hypo, { timeEpoch: hypo.timeEpoch + 40_000 }, picks), null);

  const mostlyWrong = picks.map((p, i) => (i < 3 ? { ...p, tP: p.tP + 15_000 } : p));
  assert.equal(matchDetectedEvent(hypo, { timeEpoch: hypo.timeEpoch }, mostlyWrong), null);
  const oneWrong = picks.map((p, i) => (i === 0 ? { ...p, tP: p.tP + 15_000 } : p));
  assert.ok(matchDetectedEvent(hypo, { timeEpoch: hypo.timeEpoch }, oneWrong));
  assert.equal(matchDetectedEvent(hypo, { timeEpoch: hypo.timeEpoch }, []), null);
});
