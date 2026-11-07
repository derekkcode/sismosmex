import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTravelTime1D, SeismicDetectorEngine } from '../src/server/seedlink/detector.ts';
import { SeismicDspEngine } from '../src/server/seedlink/seismic-dsp.ts';
import { SeedLinkService } from '../src/server/seedlink/service.ts';

function createNoise() {
  return {
    getThresholds: () => ({
      ratioThreshold: 2,
      minPgaGal: 0.03,
      strongMotionGal: 2,
      quarantined: false,
      noiseClass: 'NORMAL',
      ready: true,
      penalty: 0,
      medianPga: 0,
      highPga: 0,
    }),
    observe: () => {},
    reportStuckTrigger: () => {},
  };
}

function createSignalStream(packetSamples) {
  const dsp = new SeismicDspEngine({ noiseCalibrator: createNoise() });
  const rate = 100;
  const startTime = Date.UTC(2026, 0, 1);
  let offset = 0;
  return (amplitude) => {
    const start = offset;
    const samples = Int32Array.from({ length: packetSamples }, (_, i) =>
      Math.round(amplitude * Math.sin(2 * Math.PI * 5 * (start + i) / rate))
    );
    offset += samples.length;
    return dsp.processSamples(
      'IG', 'TEST', 'HNZ', rate, new Date(startTime + start * 10).toISOString(),
      samples, { sensitivity: 100000, inputType: 'ACCELERATION' }
    );
  };
}

function syntheticStations(detector, source, origin) {
  const coords = [
    [19, -100], [19.25, -99.7], [18.8, -99.65],
    [18.75, -100.3], [19.3, -100.35], [19.05, -100.5],
    [19, -101.7], [19, -98.3],
  ];
  return coords.map(([lat, lon], i) => {
    const distance = detector.haversineDistanceKm(source.lat, source.lon, lat, lon);
    const tP = origin + Math.round(calculateTravelTime1D(distance, 15, 'P') * 1000);
    return {
      station: `S${i}`, network: 'IG', channel: 'HHZ', lat, lon,
      site: '', stateName: '', tP, tP_iso: new Date(tP).toISOString(),
      receivedWallTime: Date.now(), staLtaRatio: 5, maxPga: 0.08, maxAmp: 1,
      reqRatio: 2.1, reqPga: 0.03,
    };
  });
}

test('a calibrated weak signal is not rejected because it has fewer than 100 raw counts', () => {
  const process = createSignalStream(100);
  for (let i = 0; i < 32; i++) assert.equal(process(2).staLta.triggered, false);
  const pulse = process(50);
  assert.ok(pulse.pga >= 0.03 && pulse.pga < 0.1);
  assert.ok(pulse.staLta.peakRatio >= 2);
  assert.equal(pulse.staLta.triggeredInPacket, true);
});

test('a signal below the calibrated PGA threshold does not open a trigger', () => {
  const process = createSignalStream(100);
  for (let i = 0; i < 32; i++) process(2);
  const pulse = Array.from({ length: 3 }, () => process(15));
  assert.ok(pulse.every((packet) => packet.pga < 0.03));
  assert.ok(pulse.every((packet) => !packet.staLta.triggeredInPacket));
});

test('the same weak onset is retained across multiple packet sizes', () => {
  const starts = [];
  for (const packetSamples of [10, 20, 50, 100, 200]) {
    const process = createSignalStream(packetSamples);
    for (let i = 0; i < 3200 / packetSamples; i++) process(2);
    const pulse = Array.from({ length: 400 / packetSamples }, () => process(50));
    const first = pulse.find((packet) => packet.staLta.triggeredInPacket);
    assert.ok(first);
    starts.push(Date.parse(first.staLta.triggerTimeIso));
  }
  assert.ok(Math.max(...starts) - Math.min(...starts) <= 100);
});

test('short consecutive packets retain the STA window and eventually release after the pulse', () => {
  const process = createSignalStream(10);
  for (let i = 0; i < 320; i++) assert.equal(process(2).staLta.triggered, false);
  const burst = Array.from({ length: 20 }, () => process(400));
  const first = burst.findIndex((packet) => packet.staLta.triggered);
  assert.ok(first >= 0 && first < burst.length - 1);
  assert.ok(burst.slice(first).every((packet) => packet.staLta.triggered));
  const quiet = Array.from({ length: 100 }, () => process(2));
  assert.equal(quiet.at(-1).staLta.triggered, false);
});

test('a trigger retains its earlier physical peak when it opens in a quieter packet', (t) => {
  t.mock.method(console, 'log', () => {});
  const startMs = Date.now() - 40000;
  const received = [];
  const detector = Object.create(SeismicDetectorEngine.prototype);
  detector.earthquakes = [];
  detector.activeTriggers = new Map();
  detector.amplitudeTrackingMap = new Map();
  detector.channelActivity = new Map();
  detector.requestEvaluation = () => {};
  const service = Object.create(SeedLinkService.prototype);
  service.stationsCatalog = new Map([['TEST', {
    lat: 16, lon: -99, network: 'IG',
    channels: [{ code: 'HNZ', sensitivity: 100000, inputType: 'ACCELERATION' }],
  }]]);
  service.liveStates = new Map();
  service.streamLastPacketTime = new Map();
  service.onsetBuffers = new Map();
  service.activeSwarmStations = new Set();
  service.receptionQc = { observe: () => ({ gate: 'OK', transition: false }) };
  service.dsp = new SeismicDspEngine({ noiseCalibrator: createNoise() });
  service.detector = {
    processStationTelemetry: (telemetry) => {
      received.push(telemetry);
      detector.processStationTelemetry(telemetry);
    },
    clearStationTrigger: () => {},
  };
  service.appendWaveformPoints = () => {};
  service.broadcastWebSocket = () => {};

  for (let packet = 0; packet < 322; packet++) {
    const amplitude = packet === 320 ? 50 : 2;
    const samples = Int32Array.from({ length: 10 }, (_, i) =>
      Math.round(amplitude * Math.sin(2 * Math.PI * 5 * (packet * 10 + i) / 100))
    );
    service.handleIncomingMiniSeedRecord('test', {
      station: 'TEST', network: 'IG', channel: 'HNZ', sampleRate: 100,
      startTime: { isoTime: new Date(startMs + packet * 100).toISOString() },
      samples,
    });
  }

  const trigger = received.find((telemetry) => telemetry.triggered);
  assert.ok(trigger);
  assert.ok(service.liveStates.get('TEST').pga < 0.03);
  assert.ok(trigger.pga >= 0.03);
  assert.ok(detector.activeTriggers.get('TEST')?.maxPga >= 0.03);
});

test('an oversized group retains a physically consistent six-site subset', (t) => {
  t.mock.method(console, 'log', () => {});
  const detector = Object.create(SeismicDetectorEngine.prototype);
  detector.rejectLogAt = new Map();
  const origin = Date.now() - 40000;
  const stations = syntheticStations(detector, { lat: 19, lon: -100 }, origin);
  assert.ok(detector.localizeCluster(stations.slice(0, 6), 295));
  const result = detector.localizeCluster(stations, 295);
  assert.ok(result);
  assert.ok(result.sites.length >= 6);
  assert.ok(result.apertureKm <= 295);
  assert.ok(result.epi.rmsResidualSec <= 1);
  assert.ok(Math.abs(result.epi.latitude - 19) < 0.1);
  assert.ok(Math.abs(result.epi.longitude + 100) < 0.1);

  const inconsistent = stations.slice(0, 6).map((station, i) => ({
    ...station,
    tP: station.tP + i * 20000,
  }));
  assert.equal(detector.localizeCluster(inconsistent, 295), null);

  const colocated = stations.slice(0, 6).map((station, i) =>
    i === 5 ? { ...station, lat: stations[4].lat, lon: stations[4].lon } : station
  );
  assert.equal(detector.localizeCluster(colocated, 295), null);
});

test('weak local and regional arrivals can reach preliminary event declaration', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const source of [{ lat: 19, lon: -100 }, { lat: 17.2, lon: -99.4 }]) {
    const detector = Object.create(SeismicDetectorEngine.prototype);
    detector.rejectLogAt = new Map();
    detector.earthquakes = [];
    detector.activePreliminaryIds = new Set();
    detector.historyReady = false;
    detector.lastDiagSignature = '';
    const notifications = [];
    detector.onEventDetectedCallback = (event) => notifications.push(event);
    const stations = syntheticStations(detector, source, Date.now() - 40000);
    detector.activeTriggers = new Map(stations.map((station) => [station.station, station]));

    detector.evaluateSpatialCoincidence();

    assert.equal(detector.earthquakes.length, 1);
    assert.equal(detector.earthquakes[0].status, 'PRELIMINARY');
    assert.ok(detector.earthquakes[0].stationCount >= 6);
    assert.ok(notifications.length > 0);
  }
});

test('millisecond rounding does not discard a contiguous packet or admit a real overlap', () => {
  const startMs = Date.now() - 2000;
  const processedStarts = [];
  const service = Object.create(SeedLinkService.prototype);
  service.stationsCatalog = new Map([['TEST', { lat: 16, lon: -99, network: 'IG' }]]);
  service.liveStates = new Map();
  service.streamLastPacketTime = new Map();
  service.onsetBuffers = new Map();
  service.activeSwarmStations = new Set();
  service.receptionQc = { observe: () => ({ gate: 'OK', transition: false }) };
  service.dsp = {
    processSamples: (_network, _station, _channel, _rate, startTime) => {
      processedStarts.push(startTime);
      return {
        startTime, endTime: startTime, pga: 0, amplitudePhysical: 0,
        staLta: { triggered: false, triggeredInPacket: false, peakRatio: 1, ratio: 1, minPgaGal: 0.03 },
        noise: { noiseClass: 'NORMAL' },
      };
    },
  };
  service.detector = { processStationTelemetry: () => {}, clearStationTrigger: () => {} };
  service.appendWaveformPoints = () => {};
  service.broadcastWebSocket = () => {};
  const record = (start) => ({
    station: 'TEST', network: 'IG', channel: 'HNZ', sampleRate: 30,
    startTime: { isoTime: new Date(start).toISOString() },
    samples: Int32Array.from({ length: 10 }, (_, i) => i),
  });

  service.handleIncomingMiniSeedRecord('test', record(startMs));
  service.handleIncomingMiniSeedRecord('test', record(startMs + 333));
  service.handleIncomingMiniSeedRecord('test', record(startMs + 633));
  assert.deepEqual(processedStarts, [
    new Date(startMs).toISOString(),
    new Date(startMs + 333).toISOString(),
  ]);

  service.streamLastPacketTime.clear();
  processedStarts.length = 0;
  const highRate = (start) => ({ ...record(start), sampleRate: 1000 });
  service.handleIncomingMiniSeedRecord('test', highRate(startMs));
  service.handleIncomingMiniSeedRecord('test', highRate(startMs + 9));
  assert.deepEqual(processedStarts, [new Date(startMs).toISOString()]);
});
