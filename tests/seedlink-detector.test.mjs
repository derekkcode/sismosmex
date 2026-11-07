import test from 'node:test';
import assert from 'node:assert/strict';
import { SeismicDetectorEngine } from '../src/server/seedlink/detector.ts';
import { SeismicDspEngine } from '../src/server/seedlink/seismic-dsp.ts';
import { SeedLinkService } from '../src/server/seedlink/service.ts';

function detectorWithoutBackgroundServices() {
  const detector = Object.create(SeismicDetectorEngine.prototype);
  detector.activeTriggers = new Map();
  return detector;
}

test('only the stream that opened a trigger can clear it', () => {
  const detector = detectorWithoutBackgroundServices();
  const trigger = { station: 'TEST', network: 'IG', channel: 'HHZ' };
  detector.activeTriggers.set('TEST', trigger);

  detector.clearStationTrigger('test', 'IG', 'HNE');
  detector.clearStationTrigger('test', 'AM', 'HHZ');
  assert.equal(detector.activeTriggers.get('TEST'), trigger);

  detector.clearStationTrigger('test', 'ig', 'hhz');
  assert.equal(detector.activeTriggers.has('TEST'), false);

  detector.activeTriggers.set('TEST', trigger);
  detector.clearStationTrigger('test');
  assert.equal(detector.activeTriggers.has('TEST'), false);
});

test('an increased PGA is persisted and broadcast even when magnitude does not rise', () => {
  const detector = detectorWithoutBackgroundServices();
  const station = { maxPga: 0.1, maxAmp: 1, woodAndersonAmpMm: 0 };
  const event = {
    id: 'event-1',
    stations: [station],
    latitude: 16,
    longitude: -99,
    depth: 10,
    magnitude: 4,
    maxPga: 0.1,
    maxIntensity: 1,
  };
  let saved = 0;
  const broadcasts = [];
  detector.scheduleSave = () => saved++;
  detector.onEventDetectedCallback = (value) => broadcasts.push(value);
  detector.estimateMagnitude = () => ({
    validStationCount: 1,
    magnitude: 4,
    maxPga: 10,
    maxIntensity: 3,
  });

  detector.updateEventPeaks(event, station, 10, 1, 0);

  assert.equal(event.maxPga, 10);
  assert.equal(station.maxPga, 10);
  assert.equal(event.maxIntensity, 3);
  assert.equal(saved, 1);
  assert.deepEqual(broadcasts, [event]);
});

test('a failed history write retries the latest snapshot and pending deletions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {});
  const detector = detectorWithoutBackgroundServices();
  const writes = [];
  const deletions = [];
  let attempts = 0;
  detector.historyReady = true;
  detector.persistChain = Promise.resolve();
  detector.persistRetryTimer = null;
  detector.pendingHistoryDeletes = new Set(['deleted']);
  detector.pendingHistoryClear = false;
  detector.clearedAtMs = 0;
  detector.earthquakes = [{ id: 'first' }];
  detector.dedupeHistory = (events) => events;
  detector.historyStore = {
    async saveAll(events) {
      writes.push(events.map((event) => event.id));
      if (++attempts === 1) throw new Error('temporary database failure');
    },
    async deleteIds(ids) {
      deletions.push(ids);
    },
  };

  detector.saveEarthquakesToDisk();
  await detector.persistChain;
  assert.deepEqual([...detector.pendingHistoryDeletes], ['deleted']);
  detector.earthquakes.push({ id: 'later' });

  t.mock.timers.tick(10000);
  await detector.persistChain;

  assert.deepEqual(writes, [['first'], ['first', 'later']]);
  assert.deepEqual(deletions, [['deleted']]);
  assert.equal(detector.persistRetryTimer, null);
});

test('a trigger that starts and ends within a packet is retained for detection', (t) => {
  t.mock.method(console, 'log', () => {});
  const observations = [];
  const noise = {
    getThresholds: () => ({
      ratioThreshold: 4.8,
      minPgaGal: 0.1,
      strongMotionGal: 2,
      quarantined: false,
      noiseClass: 'NORMAL',
      ready: true,
      penalty: 0,
      medianPga: 0,
      highPga: 0,
    }),
    observe: (_key, _context, observation) => observations.push(observation),
    reportStuckTrigger: () => {},
  };
  const dsp = new SeismicDspEngine({ noiseCalibrator: noise });
  const sampleRate = 100;
  const baseTime = Date.UTC(2026, 0, 1);
  let sampleIndex = 0;
  function process(seconds, burst = false) {
    const start = sampleIndex;
    const samples = Int32Array.from({ length: seconds * sampleRate }, (_, i) => {
      const amplitude = burst && i >= 500 && i < 700 ? 6000 : 80;
      return Math.round(amplitude * Math.sin(2 * Math.PI * 5 * (start + i) / sampleRate));
    });
    sampleIndex += samples.length;
    return dsp.processSamples(
      'GI', 'TEST', 'HNZ', sampleRate,
      new Date(baseTime + start * 1000 / sampleRate).toISOString(),
      samples, { sensitivity: 400000, inputType: 'ACCELERATION' }
    );
  }

  for (let i = 0; i < 35; i++) process(1);
  const packet = process(25, true);

  assert.equal(packet.staLta.triggered, false);
  assert.equal(packet.staLta.triggeredInPacket, true);
  const onset = Date.parse(packet.staLta.triggerTimeIso);
  assert.ok(onset >= baseTime + 40000 && onset < baseTime + 42000);
  assert.equal(observations.at(-1).duringTrigger, true);

  const detector = detectorWithoutBackgroundServices();
  detector.earthquakes = [];
  detector.amplitudeTrackingMap = new Map();
  detector.channelActivity = new Map();
  detector.requestEvaluation = () => {};
  detector.processStationTelemetry({
    station: 'TEST',
    network: 'GI',
    channel: 'HNZ',
    lat: 16,
    lon: -99,
    site: 'Test',
    stateName: '',
    pga: packet.pga,
    amp: packet.amplitudePhysical,
    staLtaRatio: packet.staLta.peakRatio,
    sampleRate,
    packetStartTime: packet.startTime,
    isPureFrequencySeismic: packet.isPureFrequencySeismic,
    triggered: packet.staLta.triggered || packet.staLta.triggeredInPacket,
    triggerTimeIso: packet.staLta.triggerTimeIso,
    minPgaThreshold: packet.staLta.minPgaGal,
  });
  assert.equal(detector.activeTriggers.get('TEST')?.tP, onset);
});

test('SeedLink forwards a completed packet trigger, but blocks unhealthy streams', () => {
  const startTime = new Date(Date.now() - 2000).toISOString();
  const packet = {
    startTime,
    endTime: new Date(Date.now() - 1000).toISOString(),
    pga: 0.3,
    amplitudePhysical: 1,
    staLta: {
      triggered: false,
      triggeredInPacket: true,
      triggerTimeIso: startTime,
      peakRatio: 7,
      ratio: 1,
      minPgaGal: 0.1,
    },
    noise: { noiseClass: 'NORMAL' },
  };
  const received = [];
  const cleared = [];
  let gate = 'OK';
  const service = Object.create(SeedLinkService.prototype);
  service.stationsCatalog = new Map([['TEST', { lat: 16, lon: -99, network: 'GI' }]]);
  service.liveStates = new Map();
  service.streamLastPacketTime = new Map();
  service.onsetBuffers = new Map();
  service.activeSwarmStations = new Set();
  service.receptionQc = { observe: () => ({ gate, transition: false }) };
  service.dsp = { processSamples: () => packet };
  service.detector = {
    processStationTelemetry: (telemetry) => received.push(telemetry),
    clearStationTrigger: (...args) => cleared.push(args),
  };
  service.appendWaveformPoints = () => {};
  service.broadcastWebSocket = () => {};
  const record = {
    station: 'TEST',
    network: 'GI',
    channel: 'HNZ',
    sampleRate: 100,
    startTime: { isoTime: startTime },
    samples: Int32Array.from([1, 2, 3]),
  };

  service.handleIncomingMiniSeedRecord('test', record);
  assert.equal(received.length, 1);
  assert.equal(received[0].triggered, true);
  assert.equal(received[0].triggerTimeIso, startTime);

  gate = 'BLOCKED';
  service.streamLastPacketTime.clear();
  service.handleIncomingMiniSeedRecord('test', record);
  assert.equal(received.length, 1);
  assert.deepEqual(cleared, [['TEST', 'GI', 'HNZ']]);
});
