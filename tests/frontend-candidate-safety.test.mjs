import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const elements = new Map([
  ['seismicCandidate', { hidden: true }],
  ['seismicCandidateCount', { textContent: '' }],
]);
globalThis.document = {
  documentElement: {},
  getElementById: (id) => elements.get(id) ?? null,
};
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const scriptsUrl = pathToFileURL(path.resolve('desing', 'scripts') + path.sep).href;
const asModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const engineSource = (await readFile(path.resolve('desing', 'scripts', 'monitor-engine.js'), 'utf8'))
  .replaceAll("'/desing/scripts/", `'${scriptsUrl}`);
const { SeismicMonitorEngine } = await import(asModuleUrl(engineSource));
const uiSource = (await readFile(path.resolve('desing', 'scripts', 'seedlink-ui.js'), 'utf8'))
  .replace("import { getIntensityTheme } from './monitor-engine.js';", 'const getIntensityTheme = () => ({});')
  .replaceAll("'./i18n.js'", `'${scriptsUrl}i18n.js'`)
  .replaceAll("'./display-settings.js'", `'${scriptsUrl}display-settings.js'`);
const { SeedLinkUIManager } = await import(asModuleUrl(uiSource));

function createEngine() {
  const engine = Object.create(SeismicMonitorEngine.prototype);
  engine.state = {
    activeEvents: [], activeEvent: null, lastSavedEvent: null, simTime: 0,
    alertBoxes: [], highestIntensity: 0, realtimeMaxInt: 0, realtimeMaxPga: 0,
  };
  engine.stations = [];
  engine.audioManager = {
    playEarthquakeDeclared: () => {},
    playEstimationUpdate: () => {},
    playMeowOnce: () => {},
  };
  engine.onStateChange = () => {};
  engine.getStateSnapshot = () => engine.state;
  engine.resolveMexicanLocation = () => 'Test location';
  engine.updateAlertSectorization = () => {};
  engine.smoothFlyTo = () => {};
  return engine;
}

test('a candidate is visible but does not activate an event, history or audio', () => {
  const manager = Object.create(SeedLinkUIManager.prototype);
  let audio = 0;
  manager.earthquakes = [];
  manager.engine = { state: { activeEvent: null }, audioManager: { playDeteccion: () => audio++ } };
  manager.handleWsMessage({
    type: 'seismic_candidate',
    candidate: { stationCount: 3, stations: ['IG.A', 'IG.B', 'IG.C'], firstTriggerTime: new Date().toISOString() },
  });
  assert.equal(elements.get('seismicCandidate').hidden, false);
  assert.match(elements.get('seismicCandidateCount').textContent, /3/);
  assert.equal(manager.engine.state.activeEvent, null);
  assert.equal(manager.earthquakes.length, 0);
  assert.equal(audio, 0);

  manager.handleWsMessage({ type: 'seismic_candidate', candidate: null });
  assert.equal(elements.get('seismicCandidate').hidden, true);
  assert.equal(audio, 0);
});

test('real preliminary events cannot self-confirm, drift, or be archived as confirmed', (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = createEngine();
  engine.triggerEvent({
    id: 'real-1', latitude: 16, longitude: -99, depth: 2,
    magnitude: 4.1, status: 'PRELIMINARY', isAlert: false,
  });
  const event = engine.state.activeEvent;
  assert.equal(event.lat, 16);
  assert.equal(event.lon, -99);
  assert.equal(event.mag, 4.1);
  assert.equal(event.depth, 2);
  t.mock.timers.tick(10000);
  assert.equal(event.status, 'PRELIMINARY');
  assert.equal(event.confirmed, false);
  engine.confirmCurrentEvent({ id: event.id });
  assert.equal(event.confirmed, false);
  event.startTime = performance.now() - 10000;
  engine.updateSimulation(0.1);
  assert.equal(event.status, 'PRELIMINARY');
  assert.equal(event.confirmed, false);
  assert.equal(event.lat, 16);
  assert.equal(event.lon, -99);
  assert.equal(event.mag, 4.1);
  engine.setLastSavedEvent({ id: event.id, status: 'PRELIMINARY' });
  engine.clearActiveEvent(event.id);
  assert.equal(engine.state.lastSavedEvent, null);
});

test('explicit simulations retain their automatic confirmation', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = createEngine();
  engine.triggerEvent({
    id: 'simulation-1', latitude: 16, longitude: -99, depth: 10,
    magnitude: 4.1, status: 'PRELIMINARY', isAlert: false, isSimulation: true,
  });
  const event = engine.state.activeEvent;
  assert.equal(event.simulated, true);
  event.startTime = performance.now() - 3000;
  engine.updateSimulation(0.1);
  assert.equal(event.status, 'IN_PROGRESS');
  t.mock.timers.tick(8000);
  assert.equal(event.status, 'CONFIRMED');
  event.startTime = performance.now() - 9000;
  engine.updateSimulation(0.1);
  assert.equal(event.status, 'CONFIRMED');
});

test('an explicit confirmation stays confirmed and cannot affect a different event', (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const engine = createEngine();
  engine.triggerEvent({
    id: 'real-2', latitude: 16, longitude: -99, depth: 10,
    magnitude: 4.1, status: 'PRELIMINARY', isAlert: false,
  });
  const event = engine.state.activeEvent;
  engine.updateEventEstimation({ id: 'different', latitude: 0 });
  assert.equal(event.lat, 16);
  engine.confirmCurrentEvent({ id: 'different', status: 'CONFIRMED' });
  assert.equal(event.id, 'real-2');
  assert.equal(event.confirmed, false);
  engine.confirmCurrentEvent({ id: 'real-2', status: 'CONFIRMED' });
  event.startTime = performance.now() - 10000;
  engine.updateSimulation(0.1);
  assert.equal(event.status, 'CONFIRMED');
  assert.equal(event.confirmed, true);
  assert.equal(event.serverConfirmed, true);
  assert.equal(event.lat, 16);
  assert.equal(event.lon, -99);
});
