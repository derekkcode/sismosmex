import test from 'node:test';
import assert from 'node:assert/strict';
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

test('a packet peak reaches the detector even when the next packet is quieter', () => {
  const startMs = Date.now() - 40000;
  const received = [];
  const service = Object.create(SeedLinkService.prototype);
  service.stationsCatalog = new Map([['TEST', {
    lat: 16, lon: -99, network: 'IG',
    channels: [{ code: 'HNZ', sensitivity: 100000, inputType: 'ACCELERATION' }],
  }]]);
  service.liveStates = new Map();
  service.streamLastPacketTime = new Map();
  service.activeSwarmStations = new Set();
  service.receptionQc = { observe: () => ({ gate: 'OK', transition: false }) };
  service.dsp = new SeismicDspEngine({ noiseCalibrator: createNoise() });
  service.detector = {
    processStationTelemetry: (telemetry) => received.push(telemetry),
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

  assert.equal(received.length, 322);
  assert.ok(received.every((telemetry) => telemetry.samples.length === 10));
  const peak = received.find((telemetry) => telemetry.pga >= 0.03);
  assert.ok(peak, 'the packet with the pulse carries its own PGA');
  assert.ok(service.liveStates.get('TEST').pga < 0.03, 'the live state shows the quieter packet');
});

test('millisecond rounding does not discard a contiguous packet or admit a real overlap', () => {
  const startMs = Date.now() - 2000;
  const processedStarts = [];
  const service = Object.create(SeedLinkService.prototype);
  service.stationsCatalog = new Map([['TEST', { lat: 16, lon: -99, network: 'IG' }]]);
  service.liveStates = new Map();
  service.streamLastPacketTime = new Map();
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
