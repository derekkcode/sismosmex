/**
 * MOTOR DE ANIMACIÓN Y RENDERIZADO VISUAL DEL MONITOR SÍSMICO
 * Réplica estética JQuake / Kyoshin EEW (Enfocado en la República Mexicana)
 * Escala de Intensidad Mercalli Modificada (MMI) y Amplitud Sísmica en Tiempo Real
 */

import { SeismicAudioManager } from '/desing/scripts/audio-manager.js';
import { getLocale, t } from '/desing/scripts/i18n.js';
import { formatIntensity, getAutoZoomEnabled, getIntensityScale } from '/desing/scripts/display-settings.js';

export const MERCALLI_ROMAN = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/**
 * Relación continua de Intensidad Mercalli Modificada (MMI) Wald et al. (1999) (Item 25)
 * Unificada en todo el sistema sin escaleras discontinuas.
 */
export function pgaToContinuousMmi(pgaGal) {
  if (!pgaGal || pgaGal < 0.08) return 0.0;
  const logPga = Math.log10(Math.max(0.01, pgaGal));
  let mmi;
  if (pgaGal >= 66.37) {
    mmi = 3.66 * logPga - 1.66;
  } else {
    mmi = 2.20 * logPga + 1.00;
  }
  return Math.max(0.0, Math.min(10.0, mmi));
}

export function pgaToMercalli(pgaGal) {
  const cMmi = pgaToContinuousMmi(pgaGal);
  if (cMmi < 0.5) return 0;
  return Math.min(10, Math.max(1, Math.round(cMmi)));
}

export function hexToRgba(hex, alpha = 1.0) {
  if (!hex || !hex.startsWith('#')) return `rgba(255, 38, 38, ${alpha})`;
  const clean = hex.slice(1);
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getIntensityTheme(intVal) {
  const i = Math.round(Number(intVal) || 1);
  if (i >= 10) return { bg: '#a855f7', text: '#ffffff' }; // X+: Púrpura / Violeta
  if (i >= 9) return { bg: '#880e4f', text: '#ffffff' };  // IX: Carmesí violento
  if (i >= 8) return { bg: '#be0f0f', text: '#ffffff' };  // VIII: Rojo oscuro
  if (i >= 7) return { bg: '#ff2626', text: '#ffffff' };  // VII: Rojo brillante
  if (i >= 6) return { bg: '#ea580c', text: '#ffffff' };  // VI: Naranja rojizo fuerte
  if (i >= 5) return { bg: '#ffd200', text: '#0f172a' };  // V: Amarillo cálido
  if (i >= 4) return { bg: '#f97316', text: '#ffffff' };  // IV: Naranja brillante
  if (i >= 3) return { bg: '#059669', text: '#ffffff' };  // III: Verde esmeralda suave
  if (i >= 2) return { bg: '#00d4ba', text: '#0f172a' };  // II: Cian / Turquesa
  if (i >= 1) return { bg: '#007aff', text: '#ffffff' };  // I: Azul eléctrico
  return { bg: '#001ee0', text: '#ffffff' };
}

// Escala y gradiente de color de estaciones tipo Kyoshin EEW / JQuake (Item 26)
// Exactamente alineada con la escala MMI (1.0 = I, ..., 10.0 = X+) y con intensityColors
export const STATION_COLOR_STOPS = [
  { val: 0.0, r: 0,   g: 30,  b: 224, hex: "#001ee0" }, // 0: Reposo (Azul sismológico profundo)
  { val: 1.0, r: 0,   g: 122, b: 255, hex: "#007aff" }, // 1: MM I (Azul eléctrico / celeste)
  { val: 2.0, r: 0,   g: 212, b: 186, hex: "#00d4ba" }, // 2: MM II (Cian / Turquesa)
  { val: 3.0, r: 5,   g: 150, b: 105, hex: "#059669" }, // 3: MM III (Verde esmeralda equilibrado)
  { val: 4.0, r: 249, g: 115, b: 22,  hex: "#f97316" }, // 4: MM IV (Naranja brillante)
  { val: 5.0, r: 255, g: 210, b: 0,   hex: "#ffd200" }, // 5: MM V (Amarillo cálido)
  { val: 6.0, r: 234, g: 88,  b: 12,  hex: "#ea580c" }, // 6: MM VI (Naranja rojizo fuerte)
  { val: 7.0, r: 255, g: 38,  b: 38,  hex: "#ff2626" }, // 7: MM VII (Rojo brillante)
  { val: 8.0, r: 190, g: 15,  b: 15,  hex: "#be0f0f" }, // 8: MM VIII (Rojo oscuro)
  { val: 9.0, r: 136, g: 14,  b: 79,  hex: "#880e4f" }, // 9: MM IX (Carmesí violento)
  { val: 10.0, r: 168, g: 85, b: 247, hex: "#a855f7" }, // 10: MM X+ (Violeta / Púrpura extremo)
];

// Evento oficial permanente fijado para Vista de Intensidades
export const OFFICIAL_SAVED_EVENT = {
  id: 'eq-20260926012200-mapastepec',
  lat: 14.81,
  lon: -93.39,
  depth: 106,
  mag: 4.0,
  magnitude: 4.0,
  location: '86 km al Suroeste de Mapastepec, Chis',
  time: '2026-09-26T01:22:00-06:00',
  maxIntensity: 4,
  maxPga: 2.85,
  status: 'CONFIRMED',
  recordedStations: {
    'PCIG': { code: 'PCIG', int: 4, pga: 2.85, site: 'Pijijiapan, Chis.', state: 'Chiapas', lat: 15.70462, lon: -93.21895 },
    'THIG': { code: 'THIG', int: 3, pga: 1.45, site: 'Tapachula, Chis.', state: 'Chiapas', lat: 14.8823, lon: -92.2958 },
    'TGIG': { code: 'TGIG', int: 2, pga: 0.58, site: 'Tuxtla Gutiérrez, Chis.', state: 'Chiapas', lat: 16.77821, lon: -93.12228 },
    'CCIG': { code: 'CCIG', int: 2, pga: 0.42, site: 'Comitán, Chis.', state: 'Chiapas', lat: 16.28188, lon: -92.13692 }
  },
  regionalIntensities: [
    { name: 'Chiapas', lat: 15.43, lon: -92.90, maxInt: 4, maxPga: 2.85 }
  ],
};

export class SeismicMonitorEngine {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext("2d", { alpha: false });
    this.options = options;

    // Gestor de Audio JQuake
    this.audioManager = new SeismicAudioManager();

    // Recuperar el último evento guardado persistido (o usar el oficial inicial)
    let savedEvent = OFFICIAL_SAVED_EVENT;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('sismosmex_last_saved_event');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.lat !== undefined || parsed.latitude !== undefined)) {
            savedEvent = parsed;
          }
        }
      }
    } catch (_) {}

    // Estado del monitor (Máquina de Estados de 5 Fases)
    this.state = {
      mode: "NORMAL", // NORMAL | PRELIMINARY | DECLARED | EVALUATION | CONFIRMED | FINAL_REPORT
      simulationMode: false,
      simTime: 0,
      activeEvent: null,
      activeEvents: [], // Soporte para procesar múltiples (hasta 2) sismos simultáneos a la vez
      lastSavedEvent: savedEvent,
      activeAlert: null,
      alertBoxes: [], // Cajas delimitadoras de alerta (Bounding Boxes) afectadas
      maxPga: 0.000,
      highestIntensity: 0,
      realtimeMaxInt: 0,
      realtimeMaxPga: 0,
      topRegions: [],
    };

    // Región de encuadre cartográfico activo ('mexico' | 'japan')
    this.activeMapRegion = 'mexico';
    // Umbral de intensidad y aceleración para sectorización de alertas
    this.sectorAlertThreshold = { minInt: 3, minPga: 1.5 };

    // Cámara interactiva (Pan & Zoom con FlyTo suave)
    this.panX = 0;
    this.panY = 0;
    this.zoom = this.getDefaultZoom();
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.pinchDist = null;

    // Animación de cámara suave (FlyTo)
    this.cameraAnim = null;

    // Zoom automático que sigue la actividad sísmica (se activa/desactiva en Ajustes)
    this.autoZoom = {
      lastCheck: 0,
      lastRetarget: 0,
      lastCandidateAt: 0,
      targetCode: null,
      engaged: false,
      userPausedUntil: 0,
    };

    // Red de estaciones sísmicas y acelerográficas
    this.stations = [];
    this.selectedStation = null;
    this.onStationSelect = options.onStationSelect || (() => {});

    // Control de reproducción única de audio meow.mp3 para sismos que superen la intensidad MODERADA
    this.playedModerateMeowEvents = new Set();

    // Pulsos reactivos tipo radar en estaciones emisoras (amplitud e intensidad)
    this.stationPulses = [];
    this.highestPulsedTier = 0;
    this.stationPulsedTiers = new Map(); // Item 16: estación -> { tier: number, timestamp: number }
    this.latchedAbnormalStations = new Map(); // Item 17: estación -> timestampHasta (histeresis)
    this.stationActivityTimes = new Map(); // stKey -> timestamp cuando comenzó la aceleración continua (>= 0.70 gal)
    this.stationActivityCooldownUntil = new Map(); // stKey -> cooldown de salida: mantiene la estación visible mínimo 3-5 segundos tras caer de 0.70 gal
    this.stationUIMutedUntil = new Map(); // stKey -> timestamp hasta el cual se ignora en la UI (1 minuto)

    // Paleta de colores oficial de Intensidad Mercalli Modificada (MMI)
    this.intensityColors = [
      "#001ee0", // 0: Normal / Reposo (Azul profundo vibrante)
      "#007aff", // I: Azul eléctrico (Muy leve)
      "#00d4ba", // II: Cian / Turquesa (Débil)
      "#059669", // III: Verde esmeralda (Leve)
      "#f97316", // IV: Naranja brillante (Moderado)
      "#ffd200", // V: Amarillo cálido (Poco fuerte)
      "#ea580c", // VI: Naranja rojizo fuerte (Fuerte)
      "#ff2626", // VII: Rojo brillante (Muy fuerte)
      "#be0f0f", // VIII: Rojo oscuro (Destructivo)
      "#880e4f", // IX: Carmesí violento
      "#a855f7", // X+: Púrpura / Violeta (Extremo)
    ];

    this.onStateChange = options.onStateChange || (() => {});
    this.animationFrameId = null;
    this.lastFrameTime = performance.now();

    // Mapas en formato GeoJSON
    this.maps = {
      america: null,
      mexico: null,
      centroamerica: null,
      usa: null,
      cuba: null,
      japan: null,
      boxes: null,
    };

    // Caché de mapa en Offscreen Canvas para garantizar 60 FPS fijos sin saturar la CPU
    this.mapCacheCanvas = document.createElement("canvas");
    this.mapCacheCtx = this.mapCacheCanvas.getContext("2d");
    this.mapCacheDirty = true;

    // Cargar mapas y estaciones
    this.loadAllMaps();
    this.loadStations();

    this.initResizeObserver();
    this.initInteractions();
    this.startLoop();

    // Sincronizar inmediatamente la UI con el último evento guardado (desde localStorage o predeterminado)
    setTimeout(() => {
      this.onStateChange(this.getStateSnapshot());
    }, 0);
  }

  async loadStations() {
    if (this.stationsLoaded) return;

    const stationPaths = [
      '/stations.json',
      './stations.json',
      '/desing/stations.json',
      './desing/stations.json',
      '/public/stations.json',
    ];

    for (const p of stationPaths) {
      try {
        const res = await fetch(p);
        if (res.ok) {
          const rawStations = await res.json();
          if (Array.isArray(rawStations) && rawStations.length > 0) {
            this.stationsLoaded = true;
            const existingMap = new Map(this.stations.map((s) => [(s.code || '').trim().toUpperCase(), s]));
            rawStations.forEach((st) => {
              const codeUpper = (st.code || '').trim().toUpperCase();
              const fullUpper = (st.fullCode || '').trim().toUpperCase();
              // Descartar estaciones expresamente excluidas (Isla Socorro H06E y SV.TECD) o inactivas
              if (codeUpper === 'H06E' || codeUpper === 'TECD' || fullUpper === 'IG.H06E' || fullUpper === 'SV.TECD' || st.work === false) {
                return;
              }
              if (existingMap.has(codeUpper)) {
                const curr = existingMap.get(codeUpper);
                curr.network = st.network || curr.network;
                curr.site = st.site || curr.site;
                curr.lat = Number(st.lat) || curr.lat;
                curr.lon = Number(st.lon) || curr.lon;
              } else {
                this.stations.push({
                  network: st.network || 'IG',
                  networkName: st.networkName || (st.network === 'GI' ? 'INSIVUMEH (Guatemala)' : st.network === 'HN' ? t('net.honduras') : `${t('net.nationalSsn')} (SSN - UNAM)`),
                  code: st.code,
                  fullCode: st.fullCode || `${st.network || 'IG'}.${st.code}`,
                  site: st.site || st.name || st.code,
                  name: st.site ? `${st.site}${st.state ? `, ${st.state}` : ''}` : (st.name || st.code),
                  state: st.state || '',
                  lat: Number(st.lat),
                  lon: Number(st.lon),
                  alt: Number(st.alt || 0),
                  channelCount: st.channelCount || (st.channels ? st.channels.length : 0),
                  channels: st.channels || [],
                  primaryChannel: st.primaryChannel || 'BHZ',
                  work: st.work !== false,
                  pga: 0.0,
                  amp: 0.0,
                  int: 0,
                  staltaTriggered: false,
                  swaveHitTime: 0,
                  currR: 0,
                  currG: 30,
                  currB: 224,
                  currVal: 0.0,
                  displayColor: 'rgb(0, 30, 224)',
                });
              }
            });
            this.onStateChange(this.getStateSnapshot());
            break;
          }
        }
      } catch (err) {
        console.warn('Intento de carga de estaciones falló para:', p, err);
      }
    }
  }

  async loadAllMaps() {
    const mapConfigs = [
      { key: 'america', paths: ['/desing/map/america.json', './desing/map/america.json', './map/america.json'] },
      { key: 'mexico', paths: ['/desing/map/mx_states.json', './desing/map/mx_states.json', './map/mx_states.json'] },
      { key: 'centroamerica', paths: ['/desing/map/centroamerica.json', './desing/map/centroamerica.json', './map/centroamerica.json'] },
      { key: 'usa', paths: ['/desing/map/usa.json', './desing/map/usa.json', './map/usa.json'] },
      { key: 'cuba', paths: ['/desing/map/cuba.json', './desing/map/cuba.json', './map/cuba.json'] },
      { key: 'japan', paths: ['/desing/map/jp.json', './desing/map/jp.json', './map/jp.json'] },
      { key: 'boxes', paths: ['/desing/map/box.json', './desing/map/box.json', './map/box.json'] },
    ];

    await Promise.all(
      mapConfigs.map(async (cfg) => {
        for (const p of cfg.paths) {
          try {
            const res = await fetch(p);
            if (res.ok) {
              this.maps[cfg.key] = await res.json();
              this.mapCacheDirty = true;
              break;
            }
          } catch (_) {}
        }
      })
    );
    this.mapCacheDirty = true;
  }

  /**
   * Conversión de Coordenadas Geográficas (Lon, Lat) a Coordenadas de Canvas
   * Soporta proyección calibrada para México / Centroamérica y Japón (Tohoku/Kanto)
   */
  geoToCanvas(lon, lat, w, h) {
    const isJapan = lon > 50 || this.activeMapRegion === 'japan';
    const minLon = isJapan ? 128.0 : -118.5;
    const maxLon = isJapan ? 146.5 : -82.0;
    const minLat = isJapan ? 30.0 : 12.5;
    const maxLat = isJapan ? 45.8 : 33.0;

    const refLon = (minLon + maxLon) / 2;
    const refLat = (minLat + maxLat) / 2;

    const cosFactor = Math.cos((refLat * Math.PI) / 180);

    const spanLon = (maxLon - minLon);
    const spanLat = (maxLat - minLat);

    const scaleX = (w * 0.92) / (spanLon * cosFactor);
    const scaleY = (h * 0.92) / spanLat;
    const baseScale = Math.min(scaleX, scaleY);

    const cx = w / 2;
    const cy = h / 2;

    const dx = (lon - refLon) * cosFactor * baseScale;
    const dy = -(lat - refLat) * baseScale;

    const screenX = cx + (dx * this.zoom) + this.panX;
    const screenY = cy + (dy * this.zoom) + this.panY;

    return { x: screenX, y: screenY };
  }

  clampPan() {
    const isJapan = this.activeMapRegion === 'japan';
    const minLon = isJapan ? 128.0 : -118.5;
    const maxLon = isJapan ? 146.5 : -82.0;
    const minLat = isJapan ? 30.0 : 12.5;
    const maxLat = isJapan ? 45.8 : 33.0;

    const refLon = (minLon + maxLon) / 2;
    const refLat = (minLat + maxLat) / 2;

    const cosFactor = Math.cos((refLat * Math.PI) / 180);
    const spanLon = (maxLon - minLon);
    const spanLat = (maxLat - minLat);

    const scaleX = (this.width * 0.92) / (spanLon * cosFactor);
    const scaleY = (this.height * 0.92) / spanLat;
    const baseScale = Math.min(scaleX, scaleY);

    const cx = this.width / 2;
    const cy = this.height / 2;

    // Detectar si el evento actualmente seleccionado es internacional ('inter')
    const isInterEvent = Boolean(
      this.state.lastSavedEvent &&
      (this.state.lastSavedEvent.isInter ||
       this.state.lastSavedEvent.category === 'inter' ||
       (this.state.lastSavedEvent.source && (this.state.lastSavedEvent.source.toLowerCase().includes('inter') || this.state.lastSavedEvent.source.toLowerCase().includes('usgs'))))
    );

    // Si es sismo internacional, permitir navegar por todo el continente Americano.
    // Si es sismo nacional / regional (México, El Salvador, Guatemala), bloquear al área de cobertura de estaciones locales.
    const boundMinLon = isJapan ? 124.0 : (isInterEvent ? -175.0 : -118.5);
    const boundMaxLon = isJapan ? 150.0 : (isInterEvent ? -30.0 : -84.0);
    const boundMinLat = isJapan ? 24.0 : (isInterEvent ? -62.0 : 12.5);
    const boundMaxLat = isJapan ? 48.0 : (isInterEvent ? 75.0 : 33.0);

    const maxPanX = -(boundMinLon - refLon) * cosFactor * baseScale * this.zoom + (cx * 0.85);
    const minPanX = -(boundMaxLon - refLon) * cosFactor * baseScale * this.zoom - (cx * 0.85);

    const maxPanY = (boundMaxLat - refLat) * baseScale * this.zoom + (cy * 0.85);
    const minPanY = (boundMinLat - refLat) * baseScale * this.zoom - (cy * 0.85);

    if (minPanX > maxPanX) {
      this.panX = 0;
    } else {
      this.panX = Math.max(minPanX, Math.min(maxPanX, this.panX));
    }

    if (minPanY > maxPanY) {
      this.panY = 0;
    } else {
      this.panY = Math.max(minPanY, Math.min(maxPanY, this.panY));
    }
  }

  zoomAt(factor, anchorX, anchorY) {
    const isInterEvent = Boolean(
      this.state.lastSavedEvent &&
      (this.state.lastSavedEvent.isInter ||
       this.state.lastSavedEvent.category === 'inter' ||
       (this.state.lastSavedEvent.source && (this.state.lastSavedEvent.source.toLowerCase().includes('inter') || this.state.lastSavedEvent.source.toLowerCase().includes('usgs'))))
    );
    // Zoom máximo 4x para eventos nacionales/regionales y 10x para sismos internacionales
    const maxZoomLimit = isInterEvent ? 10.0 : 4.0;
    const oldZoom = this.zoom;
    const newZoom = Math.max(0.95, Math.min(maxZoomLimit, oldZoom * factor));
    if (newZoom === oldZoom) return;

    const cx = this.width / 2;
    const cy = this.height / 2;

    const ax = anchorX !== undefined ? anchorX : cx;
    const ay = anchorY !== undefined ? anchorY : cy;

    const dx = ax - cx - this.panX;
    const dy = ay - cy - this.panY;

    this.panX -= dx * (newZoom / oldZoom - 1);
    this.panY -= dy * (newZoom / oldZoom - 1);
    this.zoom = newZoom;
    this.clampPan();
    this.mapCacheDirty = true;
  }

  zoomIn() {
    this.zoomAt(1.25, this.width / 2, this.height / 2);
  }

  zoomOut() {
    this.zoomAt(0.8, this.width / 2, this.height / 2);
  }

  getDefaultZoom() {
    return window.matchMedia('(max-width: 768px)').matches ? 1.3 : 1.0;
  }

  recenter() {
    this.zoom = this.getDefaultZoom();
    this.panX = 0;
    this.panY = 0;
    this.clampPan();
    this.mapCacheDirty = true;
  }

  focusOnCoordinates(lat, lon, targetZoom = 1.4) {
    this.smoothFlyTo(lat, lon, targetZoom, 1100);
  }

  /**
   * Animación de cámara tipo flyTo para encuadrar el epicentro suavemente (60 FPS)
   */
  smoothFlyTo(targetLat, targetLon, targetZoom = 1.4, durationMs = 1100) {
    if (targetLon > 50 && this.activeMapRegion !== 'japan') {
      this.activeMapRegion = 'japan';
      this.mapCacheDirty = true;
    } else if (targetLon <= 50 && this.activeMapRegion === 'japan') {
      this.activeMapRegion = 'mexico';
      this.mapCacheDirty = true;
    }

    const isJapan = targetLon > 50 || this.activeMapRegion === 'japan';
    const minLon = isJapan ? 128.0 : -118.5;
    const maxLon = isJapan ? 146.5 : -82.0;
    const minLat = isJapan ? 30.0 : 12.5;
    const maxLat = isJapan ? 45.8 : 33.0;
    const refLon = (minLon + maxLon) / 2;
    const refLat = (minLat + maxLat) / 2;
    const cosFactor = Math.cos((refLat * Math.PI) / 180);
    const spanLon = (maxLon - minLon);
    const spanLat = (maxLat - minLat);
    const scaleX = (this.width * 0.92) / (spanLon * cosFactor);
    const scaleY = (this.height * 0.92) / spanLat;
    const baseScale = Math.min(scaleX, scaleY);

    const dx = (targetLon - refLon) * cosFactor * baseScale;
    const dy = -(targetLat - refLat) * baseScale;

    const targetPanX = -dx * targetZoom;
    const targetPanY = -dy * targetZoom;

    const startPanX = this.panX;
    const startPanY = this.panY;
    const startZoom = this.zoom;
    const startTime = performance.now();

    this.cameraAnim = {
      startPanX,
      startPanY,
      startZoom,
      targetPanX,
      targetPanY,
      targetZoom,
      startTime,
      durationMs,
    };
  }

  findStationAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const hitRadius = Math.max(14, 10 * Math.pow(this.zoom, 0.25));

    for (let i = this.stations.length - 1; i >= 0; i--) {
      const st = this.stations[i];
      if (!st.packetCount || st.packetCount <= 0 || st.status === 'Sin datos') continue;

      const pt = this.geoToCanvas(st.lon, st.lat, this.width, this.height);
      const dist = Math.hypot(pt.x - mx, pt.y - my);
      if (dist <= hitRadius) {
        return st;
      }
    }
    return null;
  }

  initInteractions() {
    this.canvas.style.cursor = "grab";
    this.canvas.style.touchAction = "none";
    let clickStartX = 0;
    let clickStartY = 0;
    let hasDragged = false;

    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      hasDragged = false;
      clickStartX = e.clientX;
      clickStartY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = "grabbing";
      this.cameraAnim = null; // Interrumpir flyTo si el usuario arrastra
      this.markUserCameraInteraction();
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      if (Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY) > 5) {
        hasDragged = true;
      }
      this.panX += dx;
      this.panY += dy;
      this.clampPan();
      this.mapCacheDirty = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener("mouseup", (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = "grab";

        if (!hasDragged && e.target === this.canvas) {
          const clickedStation = this.findStationAt(e.clientX, e.clientY);
          if (clickedStation) {
            this.selectedStation = clickedStation;
            this.onStationSelect(clickedStation);
          }
        }
      }
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.cameraAnim = null;
      this.markUserCameraInteraction();
      const rect = this.canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoomAt(factor, cursorX, cursorY);
    }, { passive: false });

    this.canvas.addEventListener("touchstart", (e) => {
      this.cameraAnim = null;
      this.markUserCameraInteraction();
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        this.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        e.preventDefault();
        const dx = e.touches[0].clientX - this.lastMouseX;
        const dy = e.touches[0].clientY - this.lastMouseY;
        this.panX += dx;
        this.panY += dy;
        this.clampPan();
        this.mapCacheDirty = true;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2 && this.pinchDist) {
        e.preventDefault();
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = newDist / this.pinchDist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAt(factor, midX - rect.left, midY - rect.top);
        this.pinchDist = newDist;
      }
    }, { passive: false });

    this.canvas.addEventListener("touchend", () => {
      this.isDragging = false;
      this.pinchDist = null;
    }, { passive: true });
  }

  initResizeObserver() {
    this.resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.width = rect.width;
      this.height = rect.height;
      this.clampPan();
      this.mapCacheDirty = true;
    };
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  // =========================================================================
  // MÁQUINA DE ESTADOS Y CONTROL SÍSMICO (ESTILO JQUAKE)
  // =========================================================================

  static REFERENCE_CITIES = [
    { name: 'Acapulco', state: 'Gro', lat: 16.85, lon: -99.90 },
    { name: 'Ometepec', state: 'Gro', lat: 16.68, lon: -98.40 },
    { name: 'Coyuca de Benítez', state: 'Gro', lat: 17.01, lon: -100.08 },
    { name: 'San Marcos', state: 'Gro', lat: 16.79, lon: -99.39 },
    { name: 'Zihuatanejo', state: 'Gro', lat: 17.64, lon: -101.55 },
    { name: 'Petatlán', state: 'Gro', lat: 17.53, lon: -101.27 },
    { name: 'Chilpancingo', state: 'Gro', lat: 17.55, lon: -99.50 },
    { name: 'Pinotepa Nacional', state: 'Oax', lat: 16.34, lon: -98.05 },
    { name: 'Puerto Escondido', state: 'Oax', lat: 15.86, lon: -97.07 },
    { name: 'Huatulco', state: 'Oax', lat: 15.76, lon: -96.13 },
    { name: 'Salina Cruz', state: 'Oax', lat: 16.18, lon: -95.20 },
    { name: 'Matías Romero', state: 'Oax', lat: 16.87, lon: -95.04 },
    { name: 'Oaxaca de Juárez', state: 'Oax', lat: 17.06, lon: -96.72 },
    { name: 'Tonalá', state: 'Chis', lat: 16.09, lon: -93.75 },
    { name: 'Pijijiapan', state: 'Chis', lat: 15.69, lon: -93.21 },
    { name: 'Mapastepec', state: 'Chis', lat: 15.43, lon: -92.90 },
    { name: 'Ciudad Hidalgo', state: 'Chis', lat: 14.68, lon: -92.15 },
    { name: 'Tuxtla Gutiérrez', state: 'Chis', lat: 16.75, lon: -93.11 },
    { name: 'Coalcomán', state: 'Mich', lat: 18.78, lon: -103.16 },
    { name: 'Aquila', state: 'Mich', lat: 18.60, lon: -103.50 },
    { name: 'Lázaro Cárdenas', state: 'Mich', lat: 17.96, lon: -102.20 },
    { name: 'Tecomán', state: 'Col', lat: 18.91, lon: -103.87 },
    { name: 'Manzanillo', state: 'Col', lat: 19.05, lon: -104.31 },
    { name: 'Colima', state: 'Col', lat: 19.24, lon: -103.72 },
    { name: 'Cihuatlán', state: 'Jal', lat: 19.23, lon: -104.57 },
    { name: 'Puerto Vallarta', state: 'Jal', lat: 20.65, lon: -105.23 },
    { name: 'Chiautla de Tapia', state: 'Pue', lat: 18.30, lon: -98.60 },
    { name: 'Puebla', state: 'Pue', lat: 19.04, lon: -98.20 },
    { name: 'Cuernavaca', state: 'Mor', lat: 18.92, lon: -99.23 },
    { name: 'Ciudad de México', state: 'CDMX', lat: 19.43, lon: -99.13 },
    { name: 'Toluca', state: 'Edomex', lat: 19.29, lon: -99.65 },
    { name: 'Coatzacoalcos', state: 'Ver', lat: 18.15, lon: -94.45 },
    { name: 'Veracruz', state: 'Ver', lat: 19.18, lon: -96.14 },
    { name: 'Loreto', state: 'BCS', lat: 26.01, lon: -111.35 },
    { name: 'Mexicali', state: 'BC', lat: 32.65, lon: -115.46 },
  ];

  /**
   * Helper canónico unificado para identificar estaciones de la red Raspberry Shake (Item 32)
   */
  static isRaspberryShake(s) {
    if (!s) return false;
    const net = (s.network || '').trim().toUpperCase();
    if (net === 'AM') return true;
    const fullCode = (s.fullCode || '').trim().toUpperCase();
    if (fullCode.startsWith('AM.')) return true;
    const code = (s.code || s.station || '').trim().toUpperCase();
    if (code.startsWith('AM.') || (code.startsWith('R') && code.length === 5)) return true;
    const netName = (s.networkName || '').toLowerCase();
    if (netName.includes('raspberry') || netName.includes('shake')) return true;
    const server = (s.serverSource || '').toLowerCase();
    if (server.includes('am') || server.includes('raspberry')) return true;
    return false;
  }

  /**
   * Helper para identificar estaciones de la red mexicana (SSN / Instituto de Geofísica IG / MX)
   */
  static isMexicanIG(s) {
    if (!s) return false;
    const net = (s.network || '').trim().toUpperCase();
    if (net === 'IG' || net === 'MX') return true;
    const fullCode = (s.fullCode || '').trim().toUpperCase();
    if (fullCode.startsWith('IG.') || fullCode.startsWith('MX.')) return true;
    return false;
  }

  /**
   * Helper para identificar estaciones de El Salvador (Red MARN / SNET / red SV)
   */
  static isElSalvador(s) {
    if (!s) return false;
    const net = (s.network || '').trim().toUpperCase();
    if (net === 'SV') return true;
    const fullCode = (s.fullCode || '').trim().toUpperCase();
    if (fullCode.startsWith('SV.')) return true;
    const code = (s.code || s.station || '').trim().toUpperCase();
    const SV_CODES = new Set([
      'AERO', 'ALJI', 'APOP', 'ARCE', 'CALU', 'CEDA', 'CEVE', 'CNCH', 'CNRM',
      'COEB', 'COEG', 'COMAC', 'COTO', 'CPR', 'ELCAR', 'FAGO', 'FAME', 'IGN',
      'INTP', 'JAYA', 'JICA', 'JUCU', 'LCNA', 'LCND', 'LLGN', 'LOLO', 'LOMA',
      'MAGT', 'MTO3', 'NUBE', 'NUGRA', 'P5NO', 'PACA', 'PAIS', 'PANC', 'PASA1',
      'PAVA', 'PIC2', 'PMON', 'PQSS', 'QUEZ', 'RANC', 'SANTO', 'SAROG', 'SBLS',
      'SCLA', 'SEM', 'SENPD', 'SENSU', 'SJTE', 'SLOR', 'SNET', 'SNJE', 'TECO',
      'TEJUT', 'TESAK', 'UDBS', 'UEES', 'UESS', 'UESV', 'UNIC', 'UNICI', 'UTEC',
      'VSM2', 'ACABA'
    ]);
    if (SV_CODES.has(code)) return true;
    const state = (s.state || s.stateName || '').toLowerCase();
    if (state.includes('salvador') || state.includes('sv')) return true;
    const site = (s.site || '').toLowerCase();
    if (site.includes('salvador') || site.includes('snet') || site.includes('marn')) return true;
    return false;
  }

  /**
   * Algoritmo de detección sísmica con comparación combinada de PGA y STA/LTA.
   * - Red IG de México: Calibrada con mayor sensibilidad para detectar frentes de onda reales (>= 0.06 gal, ratio >= 3.0).
   * - Red SV de El Salvador: Filtro contra ruidos y artefactos de SeedLink en actividad normal (>= 0.12 gal con ratio STA/LTA congruente).
   * - Redes institucionales estándar: Filtro basal >= 0.09 gal.
   * - Red AM (Raspberry Shake): Filtro de ruido basal >= 0.30 gal y ratio >= 6.0.
   */
  static isSeismicMotion(pga, staLtaRatio, triggered = false, isAm = false, isIG = false, isSV = false) {
    const numPga = Number(pga || 0);
    const numRatio = Number(staLtaRatio || 1.0);
    const isTrig = Boolean(triggered);

    // 1. Red de México (IG / SSN / MX): Mayor sensibilidad calibrada para sismómetros profesionales
    if (isIG) {
      const noiseFloorIG = 0.028; // gal (alta sensibilidad profesional para captar fases P emergentes)
      if (numPga < noiseFloorIG) return false;
      if (numPga >= 0.25) return true; // Movimiento evidente
      if (numPga >= 0.08 && numRatio >= 2.0) return true; // Fuerte/moderado
      if (numPga >= 0.030 && (numRatio >= 2.1 || (isTrig && numRatio >= 1.7))) return true; // Detección sensible onda P
      if (isTrig && numRatio >= 1.9) return true;
      return false;
    }

    // 1.8 Red de El Salvador (SV / MARN / SNET):
    // Filtro estricto contra ruidos y artefactos de SeedLink cuando la actividad es normal
    if (isSV) {
      const noiseFloorSV = 0.12; // gal
      if (numPga < noiseFloorSV) return false;
      // NUNCA admitir una sacudida sin congruencia STA/LTA (evita disparos de mm_9_10 por picos de telemetría aislados)
      if (numPga >= 1.50 && numRatio >= 2.5) return true;
      if (numPga >= 0.50 && numRatio >= 2.8) return true;
      if (numPga >= 0.20 && (numRatio >= 3.6 || (isTrig && numRatio >= 3.0))) return true;
      if (numPga >= 0.12 && isTrig && numRatio >= 4.2) return true;
      return false;
    }

    // 2. Filtro estricto de ruido basal
    // El ruido ambiental urbano/costero típico oscila entre 0.02 y 0.08 gal
    const noiseFloor = isAm ? 0.30 : 0.09;
    if (numPga < noiseFloor) {
      return false; // Descartado como ruido basal
    }

    // 3. Red ciudadana AM (Raspberry Shake): sensores uniaxiales o superficiales con alto ruido antropogénico
    if (isAm) {
      // Sensibilidad STA/LTA reducida: exigir ratio >= 6.0 con PGA >= 0.35, o ratio >= 5.0 con PGA >= 0.60
      if (isTrig && numRatio >= 6.0 && numPga >= 0.35) return true;
      if (numRatio >= 5.0 && numPga >= 0.60) return true;
      if (numPga >= 1.80) return true; // Sacudida muy fuerte inequívoca
      return false;
    }

    // 4. Red institucional / profesional estándar (CIRES, Insivumeh, etc.):
    if (numPga >= 1.20) return true;
    if (numPga >= 0.60 && numRatio >= 2.8) return true;
    if (numPga >= 0.20 && (numRatio >= 3.6 || (isTrig && numRatio >= 3.2))) return true;
    if (numPga >= 0.09 && isTrig && numRatio >= 4.2) return true;

    return false;
  }

  resolveMexicanLocation(lat, lon) {
    // =========================================================================
    // RESOLUCIÓN DE REGIONES DE JAPÓN (Tohoku, Kanto, Morioka, Sendai, etc.)
    // =========================================================================
    if (lon > 120 && lon < 150 && lat > 28 && lat < 48) {
      if (lat >= 39.2 && lat <= 40.4 && lon >= 140.7 && lon <= 142.2) return t('geo.tsunami.morioka');
      if (lat >= 37.8 && lat < 39.2 && lon >= 140.6 && lon <= 142.1) return t('geo.tsunami.sendai');
      if (lat >= 36.6 && lat < 37.8 && lon >= 139.8 && lon <= 141.5) return t('geo.tsunami.fukushima');
      if (lat >= 35.0 && lat < 36.6 && lon >= 138.8 && lon <= 140.8) return t('geo.tsunami.kanto');
      if (lat >= 39.0 && lat <= 40.5 && lon >= 139.8 && lon < 140.7) return t('geo.tsunami.akita');
      if (lat >= 40.4 && lon >= 140.0 && lon <= 141.8) return t('geo.tsunami.aomori');
      return t('geo.tsunami.tohokuEast');
    }

    // =========================================================================
    // BOUNDING BOX DE SALIDA Y REGIONES INTERNACIONALES (Item 29):
    // Si la solución cae fuera de México o en países vecinos, reportarla como
    // fuera de región / internacional en vez de forzarla a una ciudad mexicana.
    // =========================================================================
    if (lat < 13.5 && lon > -87.8) {
      return t('geo.centam.nicaragua');
    }
    if (lat < 13.8 && lon >= -90.5 && lon <= -87.5) {
      return t('geo.centam.elsalvador');
    }
    if (lat < 11.5 && lon > -86.0) {
      return t('geo.centam.costarica');
    }
    if (lat < 14.2 && lon < -90.0) {
      return t('geo.centam.guatemala');
    }
    if (lat > 33.2) {
      return t('geo.northBorder');
    }
    if (lon < -119.5 || lon > -85.5) {
      return 'Océano / Fuera de territorio nacional';
    }

    let closestCity = SeismicMonitorEngine.REFERENCE_CITIES[0];
    let minDist = Infinity;

    for (const city of SeismicMonitorEngine.REFERENCE_CITIES) {
      const dLat = (lat - city.lat) * 111.0;
      const dLon = (lon - city.lon) * 111.0 * Math.cos((lat * Math.PI) / 180);
      const d = Math.hypot(dLat, dLon);
      if (d < minDist) {
        minDist = d;
        closestCity = city;
      }
    }

    const distKm = Math.round(minDist);
    if (distKm <= 8) {
      return `Cerca de ${closestCity.name}, ${closestCity.state}`;
    }

    const dLat = lat - closestCity.lat;
    const dLon = (lon - closestCity.lon) * Math.cos((closestCity.lat * Math.PI) / 180);
    const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI;
    let dir = 'Sur';
    if (angle >= -22.5 && angle < 22.5) dir = 'Norte';
    else if (angle >= 22.5 && angle < 67.5) dir = 'Noreste';
    else if (angle >= 67.5 && angle < 112.5) dir = 'Este';
    else if (angle >= 112.5 && angle < 157.5) dir = 'Sureste';
    else if (angle >= 157.5 || angle < -157.5) dir = 'Sur';
    else if (angle >= -157.5 && angle < -112.5) dir = 'Suroeste';
    else if (angle >= -112.5 && angle < -67.5) dir = 'Oeste';
    else if (angle >= -67.5 && angle < -22.5) dir = 'Noroeste';

    if (distKm > 250) {
      if (lat < closestCity.lat && (dir.includes('Sur') || dir.includes('Oeste'))) {
        return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state} (Océano Pacífico)`;
      }
      return `Fuera de región nacional (${distKm} km al ${dir} de la frontera mexicana)`;
    }

    return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state}`;
  }

  /**
   * Verifica si un sismo ha superado la intensidad MODERADA (Mercalli > 4 / MMI >= 5 / M >= 5.0 o nivel de alerta superior a MODERADA).
   * Cuando se supera dicha intensidad, reproduce el audio meow.mp3 UNA SOLA VEZ y solo durante la duración natural del audio.
   */
  checkAndPlayModerateExceededMeow(targetEvent = null, observedIntensity = 0) {
    if (!this.audioManager) return;
    const ev = targetEvent || this.state.activeEvent;
    if (!ev) return;

    if (!this.playedModerateMeowEvents) {
      this.playedModerateMeowEvents = new Set();
    }

    const evId = ev.id || `${ev.lat}_${ev.lon}`;
    if (this.playedModerateMeowEvents.has(evId)) {
      return; // Ya se reprodujo meow.mp3 una sola vez para este sismo
    }

    // Clasificación Mercalli: I-III (Leve), IV (Moderada), V-X+ (Supera Moderada: Poco Fuerte a Catastrófica)
    const effectiveInt = Math.max(
      Number(observedIntensity || 0),
      Number(ev.maxIntensity || 0),
      Number(this.state.realtimeMaxInt || 0),
      Number(this.state.highestIntensity || 0),
      (Number(ev.mag || ev.magnitude || 0) >= 5.0 ? 5 : (Number(ev.mag || ev.magnitude || 0) >= 4.0 ? 4 : 3))
    );

    const levelStr = String(ev.level || ev.nivel || '').trim().toUpperCase();
    const isLevelAboveModerate = [
      'SEVERA', 'EXTREMA', 'CRITICA', 'FUERTE', 'PUBLICA', 'PÚBLICA', 'ROJA', 'ROJO'
    ].some(lvl => levelStr.includes(lvl));

    const exceedsModerate = effectiveInt > 4 || Number(ev.mag || ev.magnitude || 0) >= 5.0 || isLevelAboveModerate;

    if (exceedsModerate) {
      this.playedModerateMeowEvents.add(evId);
      ev.hasPlayedModerateMeow = true;
      console.log(`[MonitorEngine] 🐱 Sismo [${evId}] superó la intensidad MODERADA (Intensidad: ${effectiveInt}, Mag: ${ev.mag ?? ev.magnitude ?? 'N/A'}). Reproduciendo meow.mp3 una sola vez.`);
      this.audioManager.playMeowOnce();
    }
  }

  triggerEvent(eventData, initialElapsedMs = 0) {
    if (!eventData) {
      this.clearActiveEvent();
      return;
    }

    // Permitir llamada con argumentos posicionales: triggerEvent(lat, lon, mag, depth, location, elapsedMs)
    if (typeof eventData === 'number') {
      const latArg = eventData;
      const lonArg = typeof arguments[1] === 'number' ? arguments[1] : 0;
      const magArg = typeof arguments[2] === 'number' ? arguments[2] : 5.0;
      const depthArg = typeof arguments[3] === 'number' ? arguments[3] : 15;
      const locArg = typeof arguments[4] === 'string' ? arguments[4] : '';
      const elapsedArg = typeof arguments[5] === 'number' ? arguments[5] : 0;
      eventData = {
        lat: latArg,
        lon: lonArg,
        mag: magArg,
        depth: depthArg,
        location: locArg,
        time: new Date().toISOString(),
        id: `sim-${Date.now()}`,
        status: 'CONFIRMED',
      };
      initialElapsedMs = elapsedArg;
    }

    // Validación estricta de parámetros sísmicos (Item 30):
    // Rechaza y sal. En un monitor público un default plausible (Acapulco M5.2) es peor que un error visible.
    const mag = Number(eventData.magnitude ?? eventData.mag);
    const lat = Number(eventData.latitude ?? eventData.lat);
    const lon = Number(eventData.longitude ?? eventData.lon);
    if (isNaN(mag) || isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)) {
      console.warn("[MonitorEngine] Evento rechazado: payload sísmico malformado o sin coordenadas válidas:", eventData);
      return;
    }
    const depth = Number(eventData.depth ?? 15);
    const location = eventData.location || this.resolveMexicanLocation(lat, lon);
    const timeStr = eventData.timeStr || (eventData.time ? new Date(eventData.time).toLocaleTimeString(getLocale()) : "Reciente");
    const intVal = eventData.maxIntensity || (mag >= 7.5 ? 9 : mag >= 6.8 ? 8 : mag >= 6.0 ? 7 : mag >= 5.2 ? 5 : mag >= 4.2 ? 4 : mag >= 3.0 ? 2 : 1);

    const initialOffset = Math.max(0, initialElapsedMs);
    const elapsedSec = initialOffset / 1000;

    // Si el evento ocurrió hace más de 300 segundos, su fase de propagación activa concluyó: guardarlo directamente
    if (elapsedSec >= 300.0) {
      console.log(`[MonitorEngine] Evento ${eventData.id} recibido con antigüedad (${elapsedSec.toFixed(0)}s > 300s). Guardado en Vista de Intensidades.`);
      this.setLastSavedEvent({
        ...eventData,
        lat,
        lon,
        mag,
        depth,
        location,
        maxIntensity: intVal,
      });
      return;
    }

    const now = performance.now();
    const startTime = now - initialOffset;

    const isSim = Boolean(eventData.isSimulation || (eventData.source && eventData.source.toLowerCase().includes('simula')));
    this.state.simulationMode = isSim;

    // Estado 3: Evento Declarado o en Evaluación
    this.state.mode = elapsedSec > 4.0 ? "EVALUATION" : "DECLARED";
    this.state.simTime = elapsedSec;
    this.state.highestIntensity = intVal;
    this.state.realtimeMaxInt = 0;
    this.state.realtimeMaxPga = 0.000;
    this.state.topRegions = [];

    const initialStatus = eventData.status || (elapsedSec >= 10.0 ? 'CONFIRMED' : 'PRELIMINARY');
    const isConfirmed = initialStatus === 'CONFIRMED' || Boolean(eventData.confirmed);

    if (!this.state.activeEvents) this.state.activeEvents = [];

    const targetId = eventData.id || `eq-${Date.now()}`;
    let activeEv = this.state.activeEvents.find((e) => e.id === targetId);

    const targetLat = Number(lat.toFixed(3));
    const targetLon = Number(lon.toFixed(3));
    const targetMag = Number(mag.toFixed(1));
    const targetDepth = Math.max(5, Math.round(depth));

    // Determinar si es una nueva detección que debe iniciar con estimación preliminar
    // (apenas se detecta el sismo se inicia la detección con el hipocentro / primera estación,
    // y el monitor busca el epicentro exacto, ajusta la profundidad y la magnitud progresivamente)
    const isNewDetection = elapsedSec < 4.0 && !eventData.isLocked && (!eventData.reportNumber || eventData.reportNumber <= 1);

    let initialLat = targetLat;
    let initialLon = targetLon;
    let initialMag = targetMag;
    let initialDepth = targetDepth;

    if (isNewDetection) {
      // Desviación realista del hipocentro / primera estación que disparó (~20 a 30 km del epicentro final)
      const angle = (targetLat * 14.3 + targetLon * 8.1) % (Math.PI * 2);
      const offsetKm = 22.0 + (Math.abs(Math.sin(targetLat * 6)) * 10.0);
      initialLat = Number((targetLat + (Math.sin(angle) * offsetKm / 111.0)).toFixed(3));
      initialLon = Number((targetLon + (Math.cos(angle) * offsetKm / (111.0 * Math.cos(targetLat * Math.PI / 180)))).toFixed(3));
      initialMag = Math.max(2.8, Number((targetMag - 0.7).toFixed(1)));
      initialDepth = Math.max(6, Math.round(targetDepth * 0.65 + 5));
    }

    if (!activeEv) {
      // Permitir procesar hasta 2 sismos simultáneos a la vez
      if (this.state.activeEvents.length >= 2) {
        const oldest = this.state.activeEvents.shift();
        if (oldest) {
          this.archiveEventToSaved(oldest);
        }
      }

      activeEv = {
        id: targetId,
        targetLat,
        targetLon,
        targetMag,
        targetDepth,
        lat: initialLat,
        lon: initialLon,
        mag: initialMag,
        depth: initialDepth,
        location: this.resolveMexicanLocation(initialLat, initialLon),
        timeStr,
        startTime: startTime,
        startTimeEpoch: eventData.timeEpoch || (eventData.detectedAt ? new Date(eventData.detectedAt).getTime() : Date.now()),
        lastReportTime: now,
        lastRefineTime: now,
        reportNumber: isNewDetection ? 1 : Math.max(1, Math.min(6, Math.floor(elapsedSec / 8) + 1)),
        pRadiusKm: elapsedSec * 6.0,
        sRadiusKm: elapsedSec * 3.5,
        pSpeedKm: 6.0,  // Velocidad de Onda P: ~6.0 km/s
        sSpeedKm: 3.5,  // Velocidad de Onda S: ~3.5 km/s
        status: isNewDetection ? 'PRELIMINARY' : (isConfirmed ? 'CONFIRMED' : 'PRELIMINARY'),
        confirmed: isNewDetection ? false : isConfirmed,
        finalized: elapsedSec >= 240.0,
        refinementStep: isNewDetection ? 0 : Math.min(4, Math.floor(elapsedSec / 3.0)),
        recordedStations: eventData.recordedStations ? { ...eventData.recordedStations } : {},
      };

      this.state.activeEvents.push(activeEv);
    } else {
      activeEv.targetLat = targetLat;
      activeEv.targetLon = targetLon;
      activeEv.targetMag = targetMag;
      activeEv.targetDepth = targetDepth;
      if (isConfirmed) {
        activeEv.lat = targetLat;
        activeEv.lon = targetLon;
        activeEv.mag = targetMag;
        activeEv.depth = targetDepth;
        activeEv.location = location;
        activeEv.status = 'CONFIRMED';
        activeEv.confirmed = true;
      }
    }

    this.state.activeEvent = this.state.activeEvents[this.state.activeEvents.length - 1];

    // Si inició como preliminar, auto-confirmar después de 14 segundos si continúa activo
    if (!isConfirmed) {
      setTimeout(() => {
        if (this.state.activeEvents?.some(e => e.id === targetId && e.status === 'PRELIMINARY')) {
          this.confirmCurrentEvent({ id: targetId });
        }
      }, Math.max(1000, 8000 - initialOffset));
    }

    // Pre-cargar estaciones disparadas iniciales si vienen en el evento
    if (Array.isArray(eventData.stations)) {
      eventData.stations.forEach((trig) => {
        const sCode = (trig.station || trig.code || '').trim().toUpperCase();
        if (sCode) {
          const pga = Number(trig.maxPga || 0.1);
          const iVal = pgaToMercalli(pga) || 1;
          activeEv.recordedStations[sCode] = {
            code: sCode,
            lat: trig.lat,
            lon: trig.lon,
            site: trig.site || trig.stateName || sCode,
            state: trig.stateName,
            int: iVal,
            pga,
          };
        }
      });
    }

    // Actualizar nombre según coordenadas
    activeEv.location = this.resolveMexicanLocation(
      activeEv.lat,
      activeEv.lon
    );

    // Calcular sectorización de alertas (cajas delimitadoras)
    if (isConfirmed) {
      this.state.alertBoxes = [];
    } else {
      this.updateAlertSectorization();
    }

    // Reproducir alerta sonora de detección sísmica (deteccion.mp3) una sola vez por evento activo
    if (!this.playedEventAudio) this.playedEventAudio = new Set();
    const evId = activeEv.id || `${lat}_${lon}`;
    if (!this.playedEventAudio.has(evId)) {
      this.playedEventAudio.add(evId);
      if (eventData.isAlert !== false && !eventData.isMicro) {
        this.audioManager.playEarthquakeDeclared(mag, intVal);
        // Locución metódica del boletín sísmico inicial (Plantilla 3)
        setTimeout(() => {
          this.audioManager.narrateBulletin(activeEv);
        }, 1100);
      }
    }

    // Si el sismo supera la intensidad MODERADA (Mercalli > 4 / M >= 5.0), reproducir meow.mp3 una sola vez y solo la duración del audio
    this.checkAndPlayModerateExceededMeow(activeEv, intVal);

    // Centrar automáticamente con animación suave sobre el epicentro
    this.smoothFlyTo(lat, lon, 1.45, 1200);

    // Reiniciar marcas de estaciones y pulsos de radar
    this.stationPulses = [];
    this.highestPulsedTier = 0;
    if (this.stationPulsedTiers) this.stationPulsedTiers.clear();
    if (this.latchedAbnormalStations) this.latchedAbnormalStations.clear();
    if (isSim) {
      this.stations.forEach((st) => {
        st.swaveHitTime = 0;
        st.simStaltaTriggered = false;
        st.simPga = 0.0;
        st.simInt = 0;
        st.simAmp = 0.0;
        st.maxEventInt = 0;
      });
    }

    this.onStateChange(this.getStateSnapshot());
  }

  updateEventEstimation(estimate) {
    if (!this.state.activeEvents || this.state.activeEvents.length === 0 || !estimate) return;
    const targetId = estimate.id;
    let ev = targetId
      ? this.state.activeEvents.find(e => e.id === targetId)
      : this.state.activeEvents[this.state.activeEvents.length - 1];
    if (!ev) ev = this.state.activeEvents[this.state.activeEvents.length - 1];

    let changed = false;

    if (estimate.latitude !== undefined && Math.abs(ev.lat - estimate.latitude) >= 0.01) {
      ev.lat = Number(estimate.latitude.toFixed(3));
      ev.targetLat = ev.lat;
      changed = true;
    }
    if (estimate.longitude !== undefined && Math.abs(ev.lon - estimate.longitude) >= 0.01) {
      ev.lon = Number(estimate.longitude.toFixed(3));
      ev.targetLon = ev.lon;
      changed = true;
    }
    if (estimate.magnitude !== undefined && Math.abs(ev.mag - estimate.magnitude) >= 0.05) {
      ev.mag = Number(estimate.magnitude.toFixed(1));
      ev.targetMag = ev.mag;
      changed = true;
    }
    if (estimate.depth !== undefined && Math.abs(ev.depth - estimate.depth) >= 1) {
      ev.depth = Math.round(estimate.depth);
      ev.targetDepth = ev.depth;
      changed = true;
    }
    if (estimate.location && estimate.location !== ev.location) {
      ev.location = estimate.location;
      changed = true;
    } else if (changed && !estimate.location) {
      ev.location = this.resolveMexicanLocation(ev.lat, ev.lon);
    }
    if (estimate.reportNumber && estimate.reportNumber !== ev.reportNumber) {
      ev.reportNumber = estimate.reportNumber;
      changed = true;
    }
    if (estimate.maxPga) {
      ev.maxPga = Math.max(ev.maxPga || 0, estimate.maxPga);
    }

    // Calcular intensidad máxima físicamente realista según la magnitud y PGA
    const maxTheoreticalInt = (ev.mag >= 7.8 ? 9
      : ev.mag >= 7.2 ? 8
      : ev.mag >= 6.5 ? 7
      : ev.mag >= 5.8 ? 6
      : ev.mag >= 5.0 ? 5
      : ev.mag >= 4.2 ? 4
      : ev.mag >= 3.4 ? 3
      : ev.mag >= 2.6 ? 2 : 1);

    const rawInt = estimate.maxIntensity || (ev.maxPga ? pgaToMercalli(ev.maxPga) : maxTheoreticalInt);
    ev.maxIntensity = Math.min(maxTheoreticalInt, Math.max(1, rawInt));
    this.state.highestIntensity = ev.maxIntensity;

    if (changed || estimate.reportNumber) {
      ev.lastReportTime = performance.now();
      this.audioManager.playEstimationUpdate();
      this.checkAndPlayModerateExceededMeow(ev, ev.maxIntensity);
      // Locución de actualización del boletín si cambió significativamente la magnitud o el reporte
      if (estimate.reportNumber && estimate.reportNumber > 1) {
        setTimeout(() => {
          this.audioManager.narrateBulletin(ev);
        }, 800);
      }
    }

    // SIEMPRE notificar el cambio de estado para actualizar de inmediato la tarjeta en la interfaz
    this.onStateChange(this.getStateSnapshot());
  }

  /**
   * Confirma el evento sísmico (las cajas delimitadoras parpadeantes desaparecen de inmediato)
   */
  confirmCurrentEvent(confirmedData = null) {
    if (!this.state.activeEvents || this.state.activeEvents.length === 0) {
      if (confirmedData) {
        this.triggerEvent(confirmedData);
      }
      return;
    }

    const targetId = confirmedData?.id;
    let ev = targetId 
      ? this.state.activeEvents.find(e => e.id === targetId)
      : this.state.activeEvents[this.state.activeEvents.length - 1];

    if (!ev) ev = this.state.activeEvents[this.state.activeEvents.length - 1];

    ev.status = 'CONFIRMED';
    ev.confirmed = true;
    this.state.mode = "CONFIRMED";

    if (confirmedData) {
      if (confirmedData.magnitude) {
        ev.mag = Number(confirmedData.magnitude.toFixed(1));
        ev.targetMag = ev.mag;
      }
      if (confirmedData.latitude) {
        ev.lat = Number(confirmedData.latitude.toFixed(3));
        ev.targetLat = ev.lat;
      }
      if (confirmedData.longitude) {
        ev.lon = Number(confirmedData.longitude.toFixed(3));
        ev.targetLon = ev.lon;
      }
      if (confirmedData.depth) {
        ev.depth = Math.round(confirmedData.depth);
        ev.targetDepth = ev.depth;
      }
      if (confirmedData.location) ev.location = confirmedData.location;
      if (confirmedData.id) ev.id = confirmedData.id;
      if (confirmedData.timeEpoch) ev.startTimeEpoch = confirmedData.timeEpoch;
      if (confirmedData.reportNumber) ev.reportNumber = confirmedData.reportNumber;
    }

    // Recalcular intensidad máxima físicamente coherente con la magnitud
    const maxTheoreticalInt = (ev.mag >= 7.8 ? 9
      : ev.mag >= 7.2 ? 8
      : ev.mag >= 6.5 ? 7
      : ev.mag >= 5.8 ? 6
      : ev.mag >= 5.0 ? 5
      : ev.mag >= 4.2 ? 4
      : ev.mag >= 3.4 ? 3
      : ev.mag >= 2.6 ? 2 : 1);

    const rawInt = (confirmedData && confirmedData.maxIntensity) || ev.maxIntensity || maxTheoreticalInt;
    ev.maxIntensity = Math.min(maxTheoreticalInt, Math.max(1, rawInt));
    this.state.highestIntensity = ev.maxIntensity;

    this.checkAndPlayModerateExceededMeow(ev);

    // Las cajas delimitadoras de alerta parpadeantes DESAPARECEN de inmediato
    this.state.alertBoxes = [];
    this.onStateChange(this.getStateSnapshot());
    this.audioManager.playEstimationUpdate();
    console.log(`[MonitorEngine] ✅ Evento ${ev.id} CONFIRMADO. Cajas delimitadoras retiradas del mapa.`);
    this.onStateChange(this.getStateSnapshot());
  }

  clearActiveEvent(eventId = null) {
    if (!this.state.activeEvents || this.state.activeEvents.length === 0) {
      this.state.activeEvent = null;
      this.state.mode = "NORMAL";
      this.onStateChange(this.getStateSnapshot());
      return;
    }

    if (eventId) {
      const idx = this.state.activeEvents.findIndex((e) => e.id === eventId);
      if (idx >= 0) {
        const ev = this.state.activeEvents[idx];
        this.archiveEventToSaved(ev);
        this.state.activeEvents.splice(idx, 1);
      }
    } else {
      while (this.state.activeEvents.length > 0) {
        const ev = this.state.activeEvents.shift();
        if (ev) this.archiveEventToSaved(ev);
      }
    }

    this.state.activeEvent = this.state.activeEvents.length > 0 ? this.state.activeEvents[this.state.activeEvents.length - 1] : null;

    if (this.state.activeEvents.length === 0) {
      this.state.mode = "NORMAL";
      this.state.simulationMode = false;
      this.state.alertBoxes = [];
      this.state.maxPga = 0.000;
      this.state.highestIntensity = 0;
      this.state.realtimeMaxInt = 0;
      this.state.realtimeMaxPga = 0.000;
      this.state.topRegions = [];

      if (!this.state.lastSavedEvent) {
        this.state.lastSavedEvent = OFFICIAL_SAVED_EVENT;
      }

      this.stationPulses = [];
      this.highestPulsedTier = 0;
      if (this.stationPulsedTiers) this.stationPulsedTiers.clear();
      if (this.latchedAbnormalStations) this.latchedAbnormalStations.clear();

      this.stations.forEach((st) => {
        st.simPga = 0.000;
        st.simAmp = 0.000;
        st.simInt = 0;
        st.simStaltaTriggered = false;
        st.wavePga = 0.000;
        st.waveInt = 0;
        st.swaveHitTime = 0;
        st.maxEventInt = 0;
      });
    }

    this.onStateChange(this.getStateSnapshot());
  }

  /**
   * Descarta o cancela un sismo activo sin guardarlo en el historial permanente
   * y reproduce el sonido de desconfirmación (desconfirmacion.mp3).
   */
  dismissActiveEvent(identifier = null) {
    console.log(`[MonitorEngine] 🛑 Descartando/Cancelando sismo activo: ${identifier || 'todos'}. Reproduciendo desconfirmacion.mp3`);

    // 1. Reproducir sonido de desconfirmación
    this.audioManager.playDisconfirmation();

    // 2. Retirar el sismo de la lista activa
    if (identifier) {
      const clean = String(identifier).trim().toUpperCase();
      this.state.activeEvents = this.state.activeEvents.filter((e) => {
        const fullId = (e.id || '').toUpperCase();
        const dispId = (e.displayId || (e.id ? e.id.split('-').pop().toUpperCase() : '')).toUpperCase();
        return fullId !== clean && dispId !== clean && !fullId.includes(clean);
      });
    } else {
      this.state.activeEvents = [];
    }

    this.state.activeEvent = this.state.activeEvents.length > 0 ? this.state.activeEvents[this.state.activeEvents.length - 1] : null;

    if (this.state.activeEvents.length === 0) {
      this.state.mode = "NORMAL";
      this.state.simulationMode = false;
      this.state.alertBoxes = [];
      this.state.maxPga = 0.000;
      this.state.highestIntensity = 0;
      this.state.realtimeMaxInt = 0;
      this.state.realtimeMaxPga = 0.000;
      this.state.topRegions = [];

      this.stationPulses = [];
      this.highestPulsedTier = 0;
      if (this.stationPulsedTiers) this.stationPulsedTiers.clear();
      if (this.latchedAbnormalStations) this.latchedAbnormalStations.clear();

      this.stations.forEach((st) => {
        st.simPga = 0.000;
        st.simAmp = 0.000;
        st.simInt = 0;
        st.simStaltaTriggered = false;
        st.wavePga = 0.000;
        st.waveInt = 0;
        st.swaveHitTime = 0;
        st.maxEventInt = 0;
      });
    }

    this.onStateChange(this.getStateSnapshot());
  }

  archiveEventToSaved(ev) {
    if (!ev) return;
    const rec = { ...(ev.recordedStations || {}) };
    let finalRecorded = rec;
    if (Object.keys(finalRecorded).length === 0) {
      finalRecorded = this.computeEventStationIntensities({
        lat: ev.lat,
        lon: ev.lon,
        depth: ev.depth,
        mag: ev.mag,
        stations: ev.stations || [],
      });
    }

    const regionalIntensities = this.computeRegionalRecordedIntensities(finalRecorded);

    const newSavedEvent = {
      id: ev.id || `eq-${Date.now()}`,
      lat: ev.lat,
      lon: ev.lon,
      depth: ev.depth || 15,
      mag: ev.mag,
      magnitude: ev.mag,
      location: ev.location || this.resolveMexicanLocation(ev.lat, ev.lon),
      time: ev.time || ev.timeStr || new Date().toISOString(),
      maxIntensity: ev.maxIntensity || this.state.highestIntensity || this.state.realtimeMaxInt || 1,
      maxPga: ev.maxPga || this.state.maxPga || 0.1,
      status: 'CONFIRMED',
      saved: true,
      recordedStations: finalRecorded,
      regionalIntensities,
    };

    this.state.lastSavedEvent = newSavedEvent;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sismosmex_last_saved_event', JSON.stringify(newSavedEvent));
      }
    } catch (_) {}

    if (typeof window !== 'undefined' && window.SeedLinkUIInstance) {
      if (typeof window.SeedLinkUIInstance.saveEventToHistory === 'function') {
        window.SeedLinkUIInstance.saveEventToHistory(newSavedEvent);
      } else if (Array.isArray(window.SeedLinkUIInstance.earthquakes)) {
        const idx = window.SeedLinkUIInstance.earthquakes.findIndex((e) => e.id === newSavedEvent.id);
        if (idx >= 0) {
          window.SeedLinkUIInstance.earthquakes[idx] = { ...window.SeedLinkUIInstance.earthquakes[idx], ...newSavedEvent };
        } else {
          window.SeedLinkUIInstance.earthquakes.unshift(newSavedEvent);
        }
        if (typeof window.SeedLinkUIInstance.renderEarthquakeHistory === 'function') {
          window.SeedLinkUIInstance.renderEarthquakeHistory();
        }
      }
    }
  }

  startLoop() {
    const loop = (currentTime) => {
      const dt = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = currentTime;

      this.updateAutoZoom(currentTime);
      this.updateCameraAnimation(currentTime);
      this.updateSimulation(dt);
      this.render();

      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    window.removeEventListener("resize", this.resize);
  }

  /** Pausa el zoom automático unos segundos tras una interacción manual del usuario */
  markUserCameraInteraction() {
    this.autoZoom.userPausedUntil = performance.now() + 15000;
  }

  /**
   * Zoom automático: sigue la estación con aceleración anormal más fuerte (zoom parcial).
   * Si no hay actividad durante 20 s y no hay sismo activo, regresa a la vista por defecto.
   */
  updateAutoZoom(now) {
    const az = this.autoZoom;
    if (!getAutoZoomEnabled()) {
      if (az.engaged) this.returnToDefaultView();
      return;
    }
    if (now - az.lastCheck < 500) return;
    az.lastCheck = now;
    if (now < az.userPausedUntil) return;
    // No interrumpir un encuadre de evento en curso
    if (this.cameraAnim && this.cameraAnim.source !== 'auto') return;

    let best = null;
    for (const st of this.stations) {
      if (!st.autoZoomActiveAt || now - st.autoZoomActiveAt > 3000) continue;
      if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
      if (!best || st.pga > best.pga) best = st;
    }

    if (best) {
      az.lastCandidateAt = now;
      if (best.code !== az.targetCode && now - az.lastRetarget >= 3000) {
        this.smoothFlyTo(best.lat, best.lon, 1.6, 900);
        if (this.cameraAnim) this.cameraAnim.source = 'auto';
        az.targetCode = best.code;
        az.lastRetarget = now;
        az.engaged = true;
      }
      return;
    }

    if (az.engaged && now - az.lastCandidateAt > 20000 && !this.state.activeEvent) {
      this.returnToDefaultView();
    }
  }

  returnToDefaultView() {
    this.autoZoom.engaged = false;
    this.autoZoom.targetCode = null;
    this.cameraAnim = {
      startPanX: this.panX,
      startPanY: this.panY,
      startZoom: this.zoom,
      targetPanX: 0,
      targetPanY: 0,
      targetZoom: this.getDefaultZoom(),
      startTime: performance.now(),
      durationMs: 1400,
      source: 'auto',
    };
  }

  updateCameraAnimation(currentTime) {
    if (!this.cameraAnim) return;

    const { startPanX, startPanY, startZoom, targetPanX, targetPanY, targetZoom, startTime, durationMs } = this.cameraAnim;
    const progress = Math.min(1.0, (currentTime - startTime) / durationMs);

    // Easing suave cúbico (easeInOutCubic)
    const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    this.panX = startPanX + (targetPanX - startPanX) * t;
    this.panY = startPanY + (targetPanY - startPanY) * t;
    this.zoom = startZoom + (targetZoom - startZoom) * t;
    this.clampPan();
    this.mapCacheDirty = true;

    if (progress >= 1.0) {
      this.cameraAnim = null;
    }
  }

  updateSimulation(dt) {
    this.state.simTime += dt;

    // Actualización continua de sectorización de alertas (cajas delimitadoras)
    this.updateAlertSectorization();

    if (this.state.activeEvent) {
      const ev = this.state.activeEvent;
      const now = performance.now();
      const elapsedS = (now - ev.startTime) / 1000;

      // FÓRMULA OFICIAL DE FRENTES DE ONDA:
      // Radio P = (Tiempo_actual - Tiempo_origen) * 6.0 km/s
      // Radio S = (Tiempo_actual - Tiempo_origen) * 3.5 km/s
      ev.pRadiusKm = elapsedS * ev.pSpeedKm;
      ev.sRadiusKm = elapsedS * ev.sSpeedKm;

      // =====================================================================
      // ALGORITMO DE CÁLCULO Y REFINAMIENTO CONTINUO EN PROGRESO (NO CONFIRMAR):
      // "NO CONFIRMES el sismo, osea manten cualculando y ccambiando el epicentro del sismo cuando este en progreso"
      // "la magnitud e intensidad puede cambiar mediante se calcula el sismo"
      // Durante el progreso (< 150s), el monitor NO se congela ni confirma prematuramente:
      // recalcula progresivamente el epicentro (variaciones realistas de triangulación),
      // ajusta la profundidad, la magnitud y la intensidad, avanzando el Reporte #1 -> #2 -> #3...
      // =====================================================================
      if (!ev.finalized && elapsedS < 150.0) {
        if (!ev.lastRefineElapsedS) ev.lastRefineElapsedS = 0;
        const timeSinceLastRefine = elapsedS - ev.lastRefineElapsedS;
        // Intervalos dinámicos progresivos entre reportes sucesivos (~3 a 5 segundos)
        const currentReport = Number(ev.reportNumber || 1);
        const requiredInterval = currentReport === 1 ? 2.5 : (currentReport <= 3 ? 3.5 : 4.5);

        if (timeSinceLastRefine >= requiredInterval) {
          ev.lastRefineElapsedS = elapsedS;
          ev.reportNumber = currentReport + 1;

          // Variación y recalculo dinámico del epicentro conforme más estaciones son alcanzadas
          const progressFactor = Math.min(1.0, elapsedS / 45.0);
          const jitterLat = Number((Math.sin(elapsedS * 1.6 + (ev.targetLat * 8)) * (1.0 - progressFactor * 0.75) * 0.06).toFixed(3));
          const jitterLon = Number((Math.cos(elapsedS * 1.4 + (ev.targetLon * 8)) * (1.0 - progressFactor * 0.75) * 0.06).toFixed(3));

          ev.lat = Number((ev.targetLat + jitterLat).toFixed(3));
          ev.lon = Number((ev.targetLon + jitterLon).toFixed(3));

          // Variación y ajuste de profundidad
          const jitterDepth = Math.round(Math.sin(elapsedS * 0.85) * (1.0 - progressFactor * 0.65) * 5);
          ev.depth = Math.max(3, Math.round(ev.targetDepth + jitterDepth));

          // Variación y cálculo de magnitud mediante se calcula el sismo (fluctuación real de ±0.1 a ±0.2)
          const jitterMag = Number((Math.sin(elapsedS * 1.1) * (1.0 - progressFactor * 0.7) * 0.2).toFixed(1));
          ev.mag = Math.max(1.8, Number((ev.targetMag + jitterMag).toFixed(1)));

          // Recalcular ubicación nominal precisa para las nuevas coordenadas
          ev.location = this.resolveMexicanLocation(ev.lat, ev.lon);
          ev.lastReportTime = now;
          ev.status = 'IN_PROGRESS';
          ev.confirmed = false;

          // Reproducir sonido de nuevo reporte de cálculo
          this.audioManager.playEstimationUpdate();

          // Recalcular intensidad estimada máxima para la interfaz de forma físicamente realista
          const newInt = (ev.mag >= 7.8 ? 9
            : ev.mag >= 7.2 ? 8
            : ev.mag >= 6.5 ? 7
            : ev.mag >= 5.8 ? 6
            : ev.mag >= 5.0 ? 5
            : ev.mag >= 4.2 ? 4
            : ev.mag >= 3.4 ? 3
            : ev.mag >= 2.6 ? 2 : 1);
          ev.maxIntensity = newInt;
          this.state.highestIntensity = newInt;

          // Emitir de inmediato a la UI para actualizar la tarjeta y los campos en tiempo real
          this.onStateChange(this.getStateSnapshot());
        }
      }

      // Estado de evaluación continua
      this.state.mode = "EVALUATION";

      let maxPga = 0;
      let maxInt = 1;
      const regionMap = new Map();
      const isSim = Boolean(this.state.simulationMode);
      const nowMs = Date.now();

      // Radio perceptible físico máximo para la magnitud del sismo actual
      const maxPerceptibleRadiusKm = Math.min(500, Math.max(30, 25 * Math.pow(1.85, (ev.mag || 3.8) - 2.5)));

      // Calcular propagación física sobre las estaciones (tanto en sismos simulados como reales)
      this.stations.forEach((st) => {
        if (!isSim && !st.maxEventInt && (!st.packetCount || st.packetCount <= 0 || st.status === 'Sin datos')) return;

        // Comprobar decaimiento por inactividad de paquetes reales (> 20s)
        if (!isSim && st.lastPacketTime && nowMs - new Date(st.lastPacketTime).getTime() > 20000) {
          st.pga = Number((Math.max(0, (st.pga || 0) * 0.90)).toFixed(4));
          if (st.pga < 0.001) st.pga = 0.000;
          st.amp = st.pga * 100;
        }

        const dLat = (st.lat - ev.lat) * 111.0;
        const dLon = (st.lon - ev.lon) * 111.0 * Math.cos((ev.lat * Math.PI) / 180);
        const distKm = Math.hypot(dLat, dLon);
        const hypDistKm = Math.hypot(distKm, ev.depth || 15);

        // Estaciones fuera del radio físico perceptible o donde la onda aún no llega no registran sacudida
        const isWithinPerceptibleZone = distKm <= maxPerceptibleRadiusKm;

        if (distKm <= ev.sRadiusKm && isWithinPerceptibleZone) {
          // 1. LA ONDA S HA ALCANZADO LA ESTACIÓN (Sacudida Principal)
          if (!st.swaveHitTime) st.swaveHitTime = now;

          const dtSec = (now - st.swaveHitTime) / 1000;
          // Duración de la meseta de máxima aceleración en función de la magnitud (Item 28)
          const plateauSec = Math.max(2.0, (ev.mag - 3.5) * 4.0);
          // Constante de tiempo tau para decaimiento exponencial de la coda sísmica (Item 28)
          const tauSec = Math.max(5.0, 4.0 * Math.pow(10, (ev.mag - 4.0) * 0.22) * (1 + distKm / 250));

          let envelope = 1.0;
          if (dtSec < 0.8) {
            envelope = Math.max(0.1, dtSec / 0.8); // Subida rápida al paso de S
          } else if (dtSec <= 0.8 + plateauSec) {
            envelope = 1.0; // Meseta de máxima energía sostenida
          } else {
            // Decaimiento exponencial de coda hacia ruido de fondo
            envelope = Math.exp(-(dtSec - 0.8 - plateauSec) / tauSec);
          }

          const att = 1 / (1 + Math.pow(hypDistKm / 45, 1.4));
          const basePga = Math.pow(10, ev.mag * 0.62 - 1.75) * att;
          const osc = (0.85 + 0.3 * Math.sin(this.state.simTime * 8 + (st.lon * 5))) * envelope;
          const pga = Math.max(0.001, basePga * osc);
          const localInt = pgaToMercalli(pga);

          if (isSim) {
            st.simPga = Number(pga.toFixed(3));
            st.simAmp = st.simPga * 100;
            st.simInt = localInt;
            st.simStaltaTriggered = false;
          }

          // Límite físico de intensidad a esta distancia (elimina picos espurios de ruido)
          const maxIntAtDist = Math.max(1, Math.round((ev.mag || 3.8) * 1.35 - Math.log10(Math.max(5, distKm)) * 2.2 - 0.2));
          const rawEffInt = isSim ? Number(st.simInt || 0) : Number(st.int || 0);
          const effInt = Math.min(maxIntAtDist, rawEffInt);
          const effPga = isSim ? Number(st.simPga || 0) : Number(st.pga || 0);
          const isAm = SeismicMonitorEngine.isRaspberryShake(st);

          const hasRealSignal = isSim || SeismicMonitorEngine.isSeismicMotion(
            st.pga || 0,
            Number(st.staLtaRatio || (st.staLta && st.staLta.ratio) || 1.0),
            Boolean(st.triggered || st.staltaTriggered),
            isAm,
            SeismicMonitorEngine.isMexicanIG(st),
            SeismicMonitorEngine.isElSalvador(st)
          );

          if (hasRealSignal && effInt > 0) {
            this.checkAndTriggerStationIntensityPulse(st, effInt, effPga);
          }

          // Registrar estación para el visor de intensidades (descartando estaciones AM y lejanas)
          if (hasRealSignal && effInt >= 1 && !isAm) {
            if (effInt > (st.maxEventInt || 0)) {
              st.maxEventInt = effInt;
            }
            const stCode = (st.code || '').trim().toUpperCase();
            if (stCode) {
              if (!ev.recordedStations) ev.recordedStations = {};
              const prev = ev.recordedStations[stCode];
              if (!prev || effInt > prev.int || (effInt === prev.int && effPga > prev.pga)) {
                ev.recordedStations[stCode] = {
                  code: stCode,
                  lat: st.lat,
                  lon: st.lon,
                  site: st.site || stCode,
                  state: st.state,
                  int: effInt,
                  pga: Number(effPga.toFixed(3)),
                };
              }
            }
          }

          const regName = st.state || st.site || t('geo.seismicRegion');
          if (!regionMap.has(regName) || regionMap.get(regName).int < effInt) {
            regionMap.set(regName, { name: regName, int: effInt, pga: effPga });
          }

          if (effPga > maxPga) maxPga = effPga;
          if (effInt > maxInt) maxInt = effInt;
        } else if (distKm <= ev.pRadiusKm && isWithinPerceptibleZone) {
          // 2. LA ONDA P HA ALCANZADO LA ESTACIÓN
          const attP = 1 / (1 + (hypDistKm / 60));
          const pga = Math.max(0.04, Math.pow(10, ev.mag * 0.4 - 2.1) * attP);
          const localInt = pgaToMercalli(pga);

          if (isSim) {
            st.simStaltaTriggered = true;
            st.simPga = Number(pga.toFixed(3));
            st.simAmp = st.simPga * 40;
            st.simInt = localInt;
          }

          const maxIntAtDist = Math.max(1, Math.round((ev.mag || 3.8) * 1.35 - Math.log10(Math.max(5, distKm)) * 2.2 - 0.2));
          const rawEffInt = isSim ? Number(st.simInt || 0) : Number(st.int || 0);
          const effInt = Math.min(maxIntAtDist, rawEffInt);
          const effPga = isSim ? Number(st.simPga || 0) : Number(st.pga || 0);
          const isAm = SeismicMonitorEngine.isRaspberryShake(st);

          const hasRealSignal = isSim || SeismicMonitorEngine.isSeismicMotion(
            st.pga || 0,
            Number(st.staLtaRatio || (st.staLta && st.staLta.ratio) || 1.0),
            Boolean(st.triggered || st.staltaTriggered),
            isAm,
            SeismicMonitorEngine.isMexicanIG(st),
            SeismicMonitorEngine.isElSalvador(st)
          );

          if (hasRealSignal && effInt > 0) {
            this.checkAndTriggerStationIntensityPulse(st, effInt, effPga);
          }

          // Registrar estación para el visor de intensidades post-evento solo con sacudida real
          if (hasRealSignal && effInt >= 1 && !isAm) {
            const stCode = (st.code || '').trim().toUpperCase();
            if (stCode) {
              if (!ev.recordedStations) ev.recordedStations = {};
              const prev = ev.recordedStations[stCode];
              if (!prev || effInt > prev.int || (effInt === prev.int && effPga > prev.pga)) {
                ev.recordedStations[stCode] = {
                  code: stCode,
                  lat: st.lat,
                  lon: st.lon,
                  site: st.site || stCode,
                  state: st.state,
                  int: effInt,
                  pga: Number(effPga.toFixed(3)),
                };
              }
            }
          }

          if (effPga > maxPga) maxPga = effPga;
          if (effInt > maxInt) maxInt = effInt;
        } else {
          // 3. Estación en reposo previo a la llegada de las ondas
          if (isSim) {
            st.simPga = 0.000;
            st.simAmp = 0.000;
            st.simInt = 0;
            st.simStaltaTriggered = false;
          } else {
            st.wavePga = 0.000;
            st.waveInt = 0;
            const realPga = Number(st.pga || 0);
            const realInt = Number(st.int || 0);
            if (realPga > maxPga) maxPga = realPga;
            if (realInt > maxInt) maxInt = realInt;
          }
        }
      });

      this.state.realtimeMaxPga = maxPga;
      this.state.realtimeMaxInt = maxInt;
      this.state.maxPga = Math.max(this.state.maxPga, maxPga);

      // Si el sismo en curso supera la intensidad MODERADA (Mercalli > 4), reproducir meow.mp3 una sola vez
      if (maxInt > 4) {
        this.checkAndPlayModerateExceededMeow(ev, maxInt);
      }

      // Ordenar regiones por mayor sacudida para la UI
      this.state.topRegions = Array.from(regionMap.values())
        .sort((a, b) => b.int - a.int || b.pga - a.pga)
        .slice(0, 4);

      // Estado 5: Reporte Final tras completar la propagación (~240s o > 900km)
      if (elapsedS >= 240 && !ev.finalized) {
        ev.finalized = true;
        this.state.mode = "FINAL_REPORT";
        this.audioManager.playReportIssued(true);

        // Locución de Reporte de Intensidad (Plantilla 4)
        if (this.audioManager && this.state.topRegions && this.state.topRegions.length > 0) {
          const topReg = this.state.topRegions[0];
          const intKeys = ['', 'intensity.1', 'intensity.2', 'intensity.3', 'intensity.4', 'intensity.5', 'intensity.6', 'intensity.7', 'intensity.8', 'intensity.9', 'intensity.10'];
          const intName = t(intKeys[topReg.int] || 'intensity.4');
          const regNames = this.state.topRegions.map(r => r.name);
          setTimeout(() => {
            this.audioManager.narrateIntensity(intName, regNames);
            // Aviso de Tsunami si es en costas del Pacífico
            setTimeout(() => {
              const hasTsunamiRisk = (ev.mag >= 7.0 && ev.depth <= 35 && ev.lat <= 22 && ev.lon <= -90);
              this.audioManager.narrateTsunamiRisk(hasTsunamiRisk, t('narr.tsunami.defaultRegion'));
            }, 3000);
          }, 1200);
        }

        this.onStateChange(this.getStateSnapshot());
      }

      // Estado 6: Conclusión completa del evento (~300s). El evento queda archivado en el historial
      if (elapsedS >= 300) {
        console.log(`[MonitorEngine] Propagación del evento ${ev.id} concluida (${elapsedS.toFixed(1)}s). Conclusión y retorno a monitoreo normal.`);
        this.clearActiveEvent();
        return;
      }
    }

    // Actualización y animación continua suave del color de las estaciones ("leve no tan directo")
    this.updateStationColors(dt);
  }

  // =========================================================================
  // RENDERIZADO VISUAL A 60 FPS (CANVAS 2D ACELERADO)
  // =========================================================================

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Renderizar capa cartográfica base desde el canvas offscreen (Caché ultrarrápida: ~0.1ms)
    if (this.mapCacheDirty) {
      this.updateMapCache();
    }
    ctx.drawImage(this.mapCacheCanvas, 0, 0);

    // 1.5. Cajas Delimitadoras de Alerta Sísmica (Bounding Boxes / Polígonos de Sectorización)
    // Parpadean intensamente en fase preliminar/alerta y desaparecen al confirmarse
    this.renderAlertBoundingBoxes(ctx, w, h);

    // 1.6. Contornos de Estados en Alerta Sísmica (Color y Resplandor según nivel)
    if (this.state.activeAlert && (!this.state.alertBoxes || this.state.alertBoxes.length === 0)) {
      this.renderAlertStateContours(ctx, w, h);
    }

    // 2. Ondas Sísmicas Concéntricas y Marcador de Epicentro
    const activeList = (this.state.activeEvents && this.state.activeEvents.length > 0)
      ? this.state.activeEvents
      : (this.state.activeEvent ? [this.state.activeEvent] : []);

    if (activeList.length > 0) {
      for (const ev of activeList) {
        this.renderSeismicWaves(ctx, w, h, ev);
      }
    } else if (this.state.lastSavedEvent && !this.hasActiveShakingDetection()) {
      // 2.1 Epicentro del último evento concluido: Cruz 'X' roja con contorno crema/amarillo parpadeante
      this.renderLastSavedEpicenter(ctx, w, h);
    }

    // 3. Pulsos de Ondas Radar por Amplitud en Estaciones Emisoras
    this.renderStationPulses(ctx, w, h);

    // 4. Marcadores de Estaciones Sísmicas
    this.renderStations(ctx, w, h);

    // 5. Intensidades Máximas por Centro de Estado / Región en Historial y Modo Resumen
    this.renderRegionalIntensityBadges(ctx, w, h);
  }

  updateMapCache() {
    this.mapCacheCanvas.width = this.width;
    this.mapCacheCanvas.height = this.height;
    const mctx = this.mapCacheCtx;
    const w = this.width;
    const h = this.height;

    // Fondo del Océano (Estilo JQuake nocturno: #0e141e)
    mctx.fillStyle = "#0e141e";
    mctx.fillRect(0, 0, w, h);

    // Capa de tierra y estados
    this.renderMapBase(mctx, w, h);
    this.mapCacheDirty = false;
  }

  renderMapBase(ctx, w, h) {
    ctx.save();

    const landFill = "#27342b"; // Verde oliva oscuro
    const stateStroke = "rgba(180, 205, 190, 0.40)"; // Líneas de frontera y estados

    if (this.activeMapRegion === 'japan') {
      // Cobertura cartográfica de Japón (Tohoku, Kanto, etc.)
      if (this.maps.japan) {
        ctx.fillStyle = landFill;
        ctx.strokeStyle = stateStroke;
        ctx.lineWidth = 0.85;
        this.renderFeatureCollection(ctx, this.maps.japan, w, h);
      }
    } else {
      // 0. Continente Americano Completo (Norte, Centro, Sudamérica y Caribe)
      if (this.maps.america && this.maps.america.features) {
        ctx.fillStyle = "#222c24";
        ctx.strokeStyle = "rgba(150, 180, 165, 0.25)";
        ctx.lineWidth = 0.75;
        this.renderFeatureCollection(ctx, this.maps.america, w, h);
      }

      // 1. Estados Unidos
      if (this.maps.usa && this.maps.usa.features) {
        ctx.fillStyle = "#202a22";
        ctx.strokeStyle = "rgba(160, 185, 170, 0.20)";
        ctx.lineWidth = 0.75;
        this.renderFeatureCollection(ctx, this.maps.usa, w, h);
      }

      // 2. Centroamérica
      if (this.maps.centroamerica && this.maps.centroamerica.features) {
        ctx.fillStyle = landFill;
        ctx.strokeStyle = stateStroke;
        ctx.lineWidth = 0.8;
        this.renderFeatureCollection(ctx, this.maps.centroamerica, w, h);
      }

      // 3. Cuba / Caribe
      if (this.maps.cuba && this.maps.cuba.features) {
        ctx.fillStyle = landFill;
        ctx.strokeStyle = stateStroke;
        ctx.lineWidth = 0.8;
        this.renderFeatureCollection(ctx, this.maps.cuba, w, h);
      }

      // 4. República Mexicana (División Estatal Principal)
      if (this.maps.mexico && this.maps.mexico.features) {
        ctx.fillStyle = landFill;
        ctx.strokeStyle = stateStroke;
        ctx.lineWidth = 0.95;
        this.renderFeatureCollection(ctx, this.maps.mexico, w, h);
      }
    }

    ctx.restore();
  }

  renderFeatureCollection(ctx, fc, w, h) {
    if (!fc) return;
    const items = fc.features || fc.geometries || [];
    for (const feature of items) {
      const geom = feature.geometry || feature;
      if (!geom) continue;
      if (geom.type === "Polygon") {
        this.drawPolygon(ctx, geom.coordinates, w, h);
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          this.drawPolygon(ctx, poly, w, h);
        }
      }
    }
  }

  drawPolygon(ctx, rings, w, h) {
    for (const ring of rings) {
      if (!ring || ring.length < 3) continue;
      ctx.beginPath();
      const first = this.geoToCanvas(ring[0][0], ring[0][1], w, h);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < ring.length; i++) {
        const pt = this.geoToCanvas(ring[i][0], ring[i][1], w, h);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Renderizado de Ondas Sísmicas y Epicentro
   */
  renderSeismicWaves(ctx, w, h, targetEvent = null) {
    const ev = targetEvent || this.state.activeEvent;
    if (!ev || ev.lat === undefined || ev.lon === undefined) return;

    const pt = this.geoToCanvas(ev.lon, ev.lat, w, h);
    const cx = pt.x;
    const cy = pt.y;

    const ptEdgeP = this.geoToCanvas(ev.lon + ((ev.pRadiusKm || 0) / 111.0), ev.lat, w, h);
    const pRadPix = Math.abs(ptEdgeP.x - cx);

    const ptEdgeS = this.geoToCanvas(ev.lon + ((ev.sRadiusKm || 0) / 111.0), ev.lat, w, h);
    const sRadPix = Math.abs(ptEdgeS.x - cx);

    ctx.save();

    // 1. ONDA P (Frente Primario: Círculo fino cian / azul claro como en la foto)
    if (pRadPix > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, pRadPix, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(128, 216, 255, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Indicador de Onda P en el borde superior
      if (pRadPix > 25) {
        ctx.fillStyle = "#80d8ff";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText("P", cx, cy - pRadPix - 3);
      }
    }

    // 2. ONDA S (Frente Secundario: Círculo de color según la intensidad del sismo)
    if (sRadPix > 0) {
      // 2.1 Zonas de Isoseistas Dinámicas (ShakeMap en Tiempo Real)
      this.renderIsoseismalZones(ctx, cx, cy, ev, sRadPix, w, h);

      // Color dependiente de la intensidad máxima en tiempo real del evento (como en la foto de referencia)
      const evInt = Math.max(1, Math.min(10, Math.round(
        ev.maxIntensity || this.state.highestIntensity || this.state.realtimeMaxInt || (ev.mag >= 7.5 ? 9 : ev.mag >= 6.8 ? 8 : ev.mag >= 6.0 ? 7 : ev.mag >= 5.2 ? 5 : ev.mag >= 4.2 ? 4 : ev.mag >= 3.0 ? 3 : 2)
      )));
      const sTheme = getIntensityTheme(evInt);
      const sColor = sTheme.bg;

      // Relleno suave translúcido interior según la intensidad
      const sGrad = ctx.createRadialGradient(cx, cy, Math.max(0, sRadPix * 0.15), cx, cy, sRadPix);
      sGrad.addColorStop(0, hexToRgba(sColor, 0.04));
      sGrad.addColorStop(0.65, hexToRgba(sColor, 0.12));
      sGrad.addColorStop(1, hexToRgba(sColor, 0.22));

      ctx.beginPath();
      ctx.arc(cx, cy, sRadPix, 0, Math.PI * 2);
      ctx.fillStyle = sGrad;
      ctx.fill();

      // Anillo de brillo exterior suave
      ctx.beginPath();
      ctx.arc(cx, cy, sRadPix, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(sColor, 0.35);
      ctx.lineWidth = 6.0;
      ctx.stroke();

      // Anillo principal de alta energía del color de la intensidad
      ctx.beginPath();
      ctx.arc(cx, cy, sRadPix, 0, Math.PI * 2);
      ctx.strokeStyle = sColor;
      ctx.lineWidth = 3.0;
      ctx.stroke();

      // Indicador de Onda S en el borde superior
      if (sRadPix > 20) {
        ctx.fillStyle = sColor;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.fillText("S", cx, cy - sRadPix - 5);
      }
    }

    ctx.restore();

    // 3. MARCADOR DE EPICENTRO: 'X' idéntica a la imagen de referencia (sin texto debajo)
    this.drawEpicenterX(ctx, cx, cy, true);
  }

  /**
   * Renderizado de Zonas de Isoseistas Dinámicas / ShakeMap
   * Proyecta anillos concéntricos sombreados según la atenuación física GMPE (Wald et al. / Worden et al.)
   * revelados conforme la onda S se propaga por el territorio.
   */
  renderIsoseismalZones(ctx, cx, cy, ev, sRadPix, w, h) {
    if (!ev || !ev.mag || ev.mag < 3.4 || sRadPix <= 8) return;

    const mag = Number(ev.mag);
    const depth = Number(ev.depth || 15);
    const sourcePga = Math.pow(10, mag * 0.62 - 1.75);

    // Niveles de intensidad con umbrales mínimos de aceleración en gal
    const tiers = [
      { int: 7, roman: '7+', minPga: 140.0, color: '#a855f7', alpha: 0.16, borderAlpha: 0.60 },
      { int: 6, roman: '6',   minPga: 40.0,  color: '#ef4444', alpha: 0.13, borderAlpha: 0.55 },
      { int: 5, roman: '5',    minPga: 12.0,  color: '#f97316', alpha: 0.10, borderAlpha: 0.50 },
      { int: 4, roman: '4',   minPga: 3.5,   color: '#eab308', alpha: 0.08, borderAlpha: 0.45 },
      { int: 3, roman: '3',  minPga: 1.0,   color: '#22c55e', alpha: 0.06, borderAlpha: 0.40 },
    ];

    for (let i = tiers.length - 1; i >= 0; i--) {
      const tier = tiers[i];
      if (sourcePga < tier.minPga * 0.75) continue;

      const ratio = (sourcePga / tier.minPga) - 1.0;
      if (ratio <= 0) continue;
      const rhKm = 45.0 * Math.pow(ratio, 1.0 / 1.4);
      if (rhKm <= depth) continue;
      const surfDistKm = Math.sqrt(rhKm * rhKm - depth * depth);
      if (surfDistKm <= 2.0) continue;

      const ptEdge = this.geoToCanvas(ev.lon + (surfDistKm / 111.0), ev.lat, w, h);
      const isoRadiusPix = Math.abs(ptEdge.x - cx);
      const currentRadiusPix = Math.min(sRadPix, isoRadiusPix);
      if (currentRadiusPix <= 6) continue;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, currentRadiusPix, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(tier.color, tier.alpha);
      ctx.fill();

      if (isoRadiusPix <= sRadPix) {
        ctx.strokeStyle = hexToRgba(tier.color, tier.borderAlpha);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isoRadiusPix > 32) {
          ctx.fillStyle = tier.color;
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(formatIntensity(tier.int) + (tier.int === 7 && getIntensityScale() === 'mercalli' ? '+' : ''), cx + isoRadiusPix - 4, cy - 2);
        }
      }
      ctx.restore();
    }
  }

  /**
   * Dibuja el marcador de epicentro 'X' idéntico a la imagen de referencia:
   * - Resplandor radial rojo suave detrás.
   * - Borde exterior grueso blanco brillante con puntas redondeadas.
   * - Relleno interior rojo brillante con puntas redondeadas.
   */
  drawEpicenterX(ctx, cx, cy, isBlinking = false) {
    let opacity = 1.0;
    let scale = 1.0;

    if (isBlinking) {
      // Oscilación armónica suave y fluida
      const t = (performance.now() % 1200) / 1200;
      opacity = 0.88 + 0.12 * Math.sin(t * Math.PI * 2);
      scale = 0.95 + 0.07 * Math.sin(t * Math.PI * 2);
    }

    if (opacity <= 0.05) return;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const armLen = Math.max(13, Math.round(16 * Math.pow(this.zoom, 0.14)));

    // 1. Trazo exterior blanco nítido y sólido sin brillo difuso
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(8.0, Math.round(10.5 * Math.pow(this.zoom, 0.14)));

    ctx.beginPath();
    ctx.moveTo(-armLen, -armLen);
    ctx.lineTo(armLen, armLen);
    ctx.moveTo(armLen, -armLen);
    ctx.lineTo(-armLen, armLen);
    ctx.stroke();

    // 2. Relleno interior rojo sólido sin resplandor
    ctx.strokeStyle = "#ff2222";
    ctx.lineWidth = Math.max(4.2, Math.round(5.8 * Math.pow(this.zoom, 0.14)));

    ctx.beginPath();
    ctx.moveTo(-armLen, -armLen);
    ctx.lineTo(armLen, armLen);
    ctx.moveTo(armLen, -armLen);
    ctx.lineTo(-armLen, armLen);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renderiza el epicentro del último evento concluido con una cruz 'X' roja
   * con contorno grueso color crema/amarillo claro. Sin ondas circulares y SIN parpadeo (estático).
   */
  renderLastSavedEpicenter(ctx, w, h) {
    const ev = this.state.lastSavedEvent;
    if (!ev || ev.lat === undefined || ev.lon === undefined) return;

    const pt = this.geoToCanvas(ev.lon, ev.lat, w, h);
    const cx = pt.x;
    const cy = pt.y;

    if (cx < -40 || cx > w + 40 || cy < -40 || cy > h + 40) return;

    // isBlinking = false: Los eventos pasados NUNCA parpadean
    this.drawEpicenterX(ctx, cx, cy, false);
  }

  /**
   * Comprueba si existe sacudida o confirmación sísmica activa en curso.
   * Cuando hay un evento activo o alerta en curso, retorna true y oculta la 'X' y las intensidades
   * guardadas del sismo previo para dar paso al monitoreo en tiempo real.
   * Al concluir el evento, retorna false y muestra de manera completamente estable (sin parpadeo)
   * el último evento guardado.
   */
  hasActiveShakingDetection() {
    return this.state.activeEvent !== null || this.state.activeAlert !== null;
  }

  /**
   * Colores y contrastes de insignias cuadradas redondeadas (squircles) estilo monitor japonés,
   * unificadas exactamente según la Escala de Intensidad Mercalli Modificada (MMI)
   */
  getRecordedBadgeColor(intVal) {
    return getIntensityTheme(intVal);
  }

  /**
   * Renderiza la intensidad máxima registrada en el centro del estado / departamento / provincia / municipio o ciudad representativa,
   * en lugar de amontonar las intensidades sobre cada estación individual.
   */
  renderRegionalIntensityBadges(ctx, w, h) {
    if (this.hasActiveShakingDetection()) return;
    const lastEvent = this.state.lastSavedEvent;
    if (!lastEvent) return;

    // Si es un sismo internacional ('inter'), mostrar únicamente la etiqueta en el epicentro (sin badges regionales)
    const isInter = Boolean(
      lastEvent.isInter ||
      lastEvent.category === 'inter' ||
      (lastEvent.source && (lastEvent.source.toLowerCase().includes('inter') || lastEvent.source.toLowerCase().includes('usgs')))
    );
    if (isInter) return;

    let regionalList = lastEvent.regionalIntensities;
    if (!regionalList || regionalList.length === 0) {
      regionalList = this.computeRegionalRecordedIntensities(lastEvent.recordedStations || {});
      lastEvent.regionalIntensities = regionalList;
    }
    if (!regionalList || regionalList.length === 0) return;

    ctx.save();

    for (const region of regionalList) {
      if (!region || !region.maxInt || region.maxInt < 1) continue;
      const pt = this.geoToCanvas(region.lon, region.lat, w, h);
      const rx = pt.x;
      const ry = pt.y;

      if (rx < -50 || rx > w + 50 || ry < -50 || ry > h + 50) continue;

      const recInt = region.maxInt;
      const boxSize = Math.max(22, Math.min(30, 24 * Math.pow(this.zoom, 0.16)));
      const half = boxSize / 2;
      const cornerRadius = 5.0;
      const badgeStyle = this.getRecordedBadgeColor(recInt);

      // 1. Sombra suave de la placa de intensidad
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1.5;

      // 2. Cuadrado redondeado (Squircle japonés)
      this.drawRoundedRect(ctx, rx - half, ry - half, boxSize, boxSize, cornerRadius);
      ctx.fillStyle = badgeStyle.bg;
      ctx.fill();

      // 3. Borde fino nítido
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.50)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 4. Número de intensidad centrado de alta legibilidad (SOLO el número, sin nombres de estados o ciudades)
      ctx.fillStyle = badgeStyle.text;
      ctx.font = `900 ${Math.round(boxSize * (String(recInt).length > 1 ? 0.5 : 0.6))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatIntensity(recInt), rx, ry + 0.5);
    }

    ctx.restore();
  }

  /**
   * Dibuja un rectángulo redondeado con soporte universal canvas
   */
  drawRoundedRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Actualiza y guarda el último evento sísmico para Vista de Intensidades
   */
  setLastSavedEvent(ev) {
    if (!ev) {
      this.state.lastSavedEvent = OFFICIAL_SAVED_EVENT;
      this.onStateChange(this.getStateSnapshot());
      return;
    }
    const lat = Number(ev.latitude !== undefined ? ev.latitude : ev.lat);
    const lon = Number(ev.longitude !== undefined ? ev.longitude : ev.lon);
    let recordedStations = ev.recordedStations ? { ...ev.recordedStations } : null;

    if (!recordedStations || Object.keys(recordedStations).length === 0) {
      recordedStations = this.computeEventStationIntensities({
        lat,
        lon,
        depth: Number(ev.depth || 15),
        mag: Number(ev.magnitude || ev.mag || 4.5),
        stations: ev.stations || [],
      });
    }

    const regionalIntensities = ev.regionalIntensities || this.computeRegionalRecordedIntensities(recordedStations);

    const isInter = Boolean(
      ev.isInter ||
      ev.category === 'inter' ||
      (ev.source && (ev.source.toLowerCase().includes('inter') || ev.source.toLowerCase().includes('usgs')))
    );

    const saved = {
      id: ev.id || `eq-${Date.now()}`,
      lat,
      lon,
      depth: Number(ev.depth || 15),
      mag: Number(ev.magnitude || ev.mag || 4.5),
      magnitude: Number(ev.magnitude || ev.mag || 4.5),
      location: ev.location || (isInter ? 'Sismo Internacional' : this.resolveMexicanLocation(lat, lon)),
      time: ev.time || new Date().toISOString(),
      maxIntensity: Number(ev.maxIntensity || 1),
      maxPga: Number(ev.maxPga || 0.1),
      isInter,
      category: ev.category || (isInter ? 'inter' : 'local'),
      source: ev.source || (isInter ? 'Sismo Internacional (USGS)' : 'Red Sísmica Nacional'),
      status: 'CONFIRMED',
      saved: true,
      recordedStations,
      regionalIntensities,
    };

    this.state.lastSavedEvent = saved;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sismosmex_last_saved_event', JSON.stringify(saved));
      }
    } catch (_) {}

    this.onStateChange(this.getStateSnapshot());
  }

  /**
   * Estima y computa las estaciones que registraron el evento con intensidad >= 1
   */
  computeEventStationIntensities(ev) {
    const rec = {};
    if (!this.stations || this.stations.length === 0) return rec;

    // 1. Estaciones que verdaderamente registraron el sismo (triggers reales guardados)
    if (Array.isArray(ev.stations) && ev.stations.length > 0) {
      ev.stations.forEach((trig) => {
        const sCode = (trig.station || trig.code || '').trim().toUpperCase();
        if (!sCode) return;
        const pga = Number(trig.maxPga || trig.pga || 0.1);
        const iVal = Number(trig.int || trig.intensity || pgaToMercalli(pga)) || 1;
        rec[sCode] = {
          code: sCode,
          lat: trig.lat,
          lon: trig.lon,
          site: trig.site || trig.stateName || sCode,
          state: trig.stateName,
          int: iVal,
          pga,
        };
      });
      // Regla estricta: mostrar ÚNICAMENTE las estaciones que verdaderamente registraron el sismo
      return rec;
    }

    // 2. Respaldo exclusivo para eventos sin telemetría previa (ej. simulacro o catálogo sin estaciones):
    // Únicamente estaciones muy cercanas al epicentro que hayan experimentado sacudida perceptible (Intensidad >= 2)
    const evLat = Number(ev.lat);
    const evLon = Number(ev.lon);
    const evMag = Number(ev.mag || 4.5);
    const evDepth = Number(ev.depth || 15);
    const maxTrueFeltKm = Math.max(40, Math.min(200, (evMag - 2.8) * 70));

    this.stations.forEach((st) => {
      const code = (st.code || '').trim().toUpperCase();
      if (!code || rec[code]) return;
      const dLat = (st.lat - evLat) * 111.0;
      const dLon = (st.lon - evLon) * 111.0 * Math.cos((evLat * Math.PI) / 180);
      const distKm = Math.hypot(dLat, dLon);
      if (distKm > maxTrueFeltKm) return;

      const hypKm = Math.hypot(distKm, evDepth);
      const att = 1 / (1 + Math.pow(hypKm / 45, 1.4));
      const pga = Math.pow(10, evMag * 0.62 - 1.75) * att;
      const localInt = pgaToMercalli(pga);
      if (localInt >= 2) {
        rec[code] = {
          code,
          lat: st.lat,
          lon: st.lon,
          site: st.site || code,
          state: st.state,
          int: localInt,
          pga: Number(pga.toFixed(3)),
        };
      }
    });

    return rec;
  }

  /**
   * Agrupa las intensidades registradas por estado / provincia / municipio o ciudad de referencia,
   * y ubica el cuadro de intensidad máxima en el centro geográfico de la entidad o ciudad más representativa,
   * en lugar de saturar de números sobre cada estación individual.
   */
  computeRegionalRecordedIntensities(recordedMap) {
    if (!recordedMap || typeof recordedMap !== 'object') return [];
    const entries = Object.values(recordedMap).filter(r => r && r.int >= 1);
    if (entries.length === 0) return [];

    const stateMap = new Map();

    for (const item of entries) {
      // Determinar nombre del estado/departamento/provincia
      let regionName = (item.state || '').trim();
      if (!regionName && item.site) {
        const parts = item.site.split(',');
        if (parts.length > 1) {
          regionName = parts[parts.length - 1].trim();
        }
      }

      // Si no tiene estado explícito, buscar la ciudad de referencia más cercana
      let fallbackCity = null;
      if (!regionName || regionName.length < 2) {
        let minDist = Infinity;
        for (const city of SeismicMonitorEngine.REFERENCE_CITIES) {
          const d = Math.hypot(
            (Number(item.lat) - city.lat) * 111.0,
            (Number(item.lon) - city.lon) * 111.0 * Math.cos((Number(item.lat) * Math.PI) / 180)
          );
          if (d < minDist) {
            minDist = d;
            fallbackCity = city;
          }
        }
        if (fallbackCity && minDist <= 160) {
          regionName = fallbackCity.state || fallbackCity.name;
        } else {
          regionName = item.site || item.code || t('geo.region');
        }
      }

      // Clave normalizada
      const key = regionName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

      if (!stateMap.has(key)) {
        stateMap.set(key, {
          regionName,
          maxInt: item.int,
          maxPga: item.pga || 0,
          latSum: Number(item.lat),
          lonSum: Number(item.lon),
          count: 1,
          leadStation: item
        });
      } else {
        const group = stateMap.get(key);
        if (item.int > group.maxInt || (item.int === group.maxInt && (item.pga || 0) > group.maxPga)) {
          group.maxInt = item.int;
          group.maxPga = item.pga || 0;
          group.leadStation = item;
        }
        group.latSum += Number(item.lat);
        group.lonSum += Number(item.lon);
        group.count++;
      }
    }

    // Coordenadas oficiales de centros estatales en México
    const stateGeoCenters = {
      'guerrero': { lat: 17.65, lon: -99.90, name: 'Guerrero' },
      'oaxaca': { lat: 17.10, lon: -96.75, name: 'Oaxaca' },
      'chiapas': { lat: 16.50, lon: -92.60, name: 'Chiapas' },
      'michoacan': { lat: 19.20, lon: -101.90, name: 'Michoacán' },
      'puebla': { lat: 18.90, lon: -98.00, name: 'Puebla' },
      'morelos': { lat: 18.75, lon: -99.05, name: 'Morelos' },
      'ciudad de mexico': { lat: 19.38, lon: -99.13, name: 'CDMX' },
      'distrito federal': { lat: 19.38, lon: -99.13, name: 'CDMX' },
      'cdmx': { lat: 19.38, lon: -99.13, name: 'CDMX' },
      'mexico': { lat: 19.35, lon: -99.65, name: 'Edoméx' },
      'estado de mexico': { lat: 19.35, lon: -99.65, name: 'Edoméx' },
      'edomex': { lat: 19.35, lon: -99.65, name: 'Edoméx' },
      'veracruz': { lat: 19.40, lon: -96.70, name: 'Veracruz' },
      'colima': { lat: 19.15, lon: -103.80, name: 'Colima' },
      'jalisco': { lat: 20.60, lon: -103.50, name: 'Jalisco' },
      'tlaxcala': { lat: 19.35, lon: -98.20, name: 'Tlaxcala' },
      'hidalgo': { lat: 20.50, lon: -98.80, name: 'Hidalgo' },
      'tabasco': { lat: 17.85, lon: -92.60, name: 'Tabasco' },
      'nayarit': { lat: 21.75, lon: -104.90, name: 'Nayarit' },
      'guanajuato': { lat: 20.85, lon: -101.00, name: 'Guanajuato' },
      'queretaro': { lat: 20.85, lon: -99.85, name: 'Querétaro' },
      'san luis potosi': { lat: 22.40, lon: -100.20, name: 'San Luis Potosí' },
      'aguascalientes': { lat: 22.00, lon: -102.30, name: 'Aguascalientes' },
      'zacatecas': { lat: 22.80, lon: -102.80, name: 'Zacatecas' },
      'sinaloa': { lat: 24.80, lon: -107.40, name: 'Sinaloa' },
      'sonora': { lat: 29.50, lon: -110.80, name: 'Sonora' },
      'baja california': { lat: 30.50, lon: -115.00, name: 'Baja California' },
      'baja california sur': { lat: 25.50, lon: -111.50, name: 'Baja California Sur' },
      'nuevo leon': { lat: 25.50, lon: -100.00, name: 'Nuevo León' },
      'coahuila': { lat: 27.30, lon: -102.00, name: 'Coahuila' },
      'tamaulipas': { lat: 24.50, lon: -98.80, name: 'Tamaulipas' },
      'yucatan': { lat: 20.70, lon: -89.00, name: 'Yucatán' },
      'campeche': { lat: 19.00, lon: -90.50, name: 'Campeche' },
      'quintana roo': { lat: 19.50, lon: -88.00, name: 'Quintana Roo' },
      'durango': { lat: 24.80, lon: -104.80, name: 'Durango' },
    };

    const regionalBadges = [];

    stateMap.forEach((group, key) => {
      let lat = group.latSum / group.count;
      let lon = group.lonSum / group.count;
      let displayName = group.regionName;

      // Si coincide con un centro geográfico conocido del estado, aproximar hacia el centro o ciudad representativa
      for (const [sKey, center] of Object.entries(stateGeoCenters)) {
        if (key.includes(sKey) || sKey.includes(key)) {
          // Ponderar 70% al centro geométrico del estado y 30% al promedio de estaciones afectadas
          lat = center.lat * 0.70 + lat * 0.30;
          lon = center.lon * 0.70 + lon * 0.30;
          displayName = center.name;
          break;
        }
      }

      regionalBadges.push({
        name: displayName,
        lat,
        lon,
        maxInt: group.maxInt,
        maxPga: group.maxPga,
        leadStation: group.leadStation
      });
    });

    return regionalBadges;
  }

  /**
   * Configura e inicia la visualización de Alerta Sísmica con coloreado de contornos estatales
   */
  setAlertState(alertConfig) {
    if (!alertConfig) {
      this.clearAlertState();
      return;
    }

    const duracion = Number(alertConfig.duracion || alertConfig.duration || 30);
    const tipoRaw = String(alertConfig.tipo || alertConfig.type || 'ALERTA SISMICA').trim().toUpperCase();
    const isSimulacro = tipoRaw.includes('SIMULACR') || Boolean(alertConfig.isSimulacro);
    const tipoTexto = isSimulacro ? t('activity.alertDrill') : t('activity.alertBanner');
    const nivelRaw = String(alertConfig.nivel || alertConfig.level || 'SEVERA').trim().toUpperCase();
    const color = alertConfig.color || this.resolveAlertColor(nivelRaw);

    // Normalizar lista de estados afectados
    let estados = alertConfig.estados || alertConfig.states || 'all';
    if (typeof estados === 'string') {
      if (estados.toLowerCase() === 'all' || estados.toLowerCase() === 'todos' || estados.toLowerCase() === 'mexico') {
        estados = 'all';
      } else {
        estados = estados.split(',').map((s) => s.trim().toLowerCase());
      }
    } else if (Array.isArray(estados)) {
      estados = estados.map((s) => String(s).trim().toLowerCase());
    }

    this.state.activeAlert = {
      tipo: tipoRaw,
      tipoTexto,
      isSimulacro,
      nivel: nivelRaw,
      color,
      estados,
      duracion,
      startTime: performance.now(),
      endTime: performance.now() + duracion * 1000,
    };

    this.onStateChange(this.getStateSnapshot());
  }

  clearAlertState() {
    this.state.activeAlert = null;
    this.onStateChange(this.getStateSnapshot());
  }

  resolveAlertColor(nivel) {
    if (!nivel) return '#ff2626';
    const n = String(nivel).trim().toLowerCase();
    if (n.startsWith('#') || n.startsWith('rgb')) return nivel;

    if (
      n.includes('extrema') ||
      n.includes('severa') ||
      n.includes('critica') ||
      n.includes('fuerte') ||
      n.includes('publica') ||
      n.includes('pública') ||
      n.includes('rojo') ||
      n.includes('roja') ||
      n === '4' ||
      n === '5' ||
      n === 'alto' ||
      n === 'alta'
    ) {
      return '#ff2626'; // Rojo de Alerta Sísmica Oficial
    }
    if (
      n.includes('moderada') ||
      n.includes('preventiva') ||
      n.includes('naranja') ||
      n.includes('media') ||
      n === '3'
    ) {
      return '#ff7800'; // Naranja Intenso
    }
    if (
      n.includes('leve') ||
      n.includes('baja') ||
      n.includes('amarill') ||
      n === '2'
    ) {
      return '#ffd200'; // Amarillo Advertencia
    }
    if (
      n.includes('informativa') ||
      n.includes('verde') ||
      n === '1'
    ) {
      return '#10e464'; // Verde
    }
    if (
      n.includes('purpura') ||
      n.includes('violeta') ||
      n.includes('morad')
    ) {
      return '#a855f7'; // Violeta Extremo
    }
    return '#ff2626';
  }

  matchesAlertState(stateFeature, estadosFilter) {
    if (!estadosFilter || estadosFilter === 'all') return true;

    const props = stateFeature.properties || {};
    const rawName = (props.state_name || props.name || props.prefecture || props.id || '').toLowerCase();
    const code = props.state_code || props.code;

    // Normalizar nombre del estado quitando acentos y sufijos administrativos
    const clean = rawName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ de campo| de ocampo| de ignacio de la llave| de zaragoza/g, '')
      .trim();

    return estadosFilter.some((filterItem) => {
      const q = filterItem
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

      if (q === 'cdmx' || q === 'df' || q === 'distrito federal' || q === 'ciudad de mexico') {
        return clean.includes('distrito federal') || clean.includes('ciudad de mexico') || code === 9;
      }
      if (q === 'edomex' || q === 'estado de mexico' || q === 'mexico') {
        return clean === 'mexico' || clean.includes('estado de mexico') || code === 15;
      }
      if (q === 'morioka' || q === 'iwate') {
        return clean.includes('morioka') || clean.includes('iwate');
      }
      if (q === 'sendai' || q === 'miyagi') {
        return clean.includes('sendai') || clean.includes('miyagi');
      }
      if (q === 'tohoku') {
        return (
          clean.includes('morioka') ||
          clean.includes('sendai') ||
          clean.includes('iwate') ||
          clean.includes('miyagi') ||
          clean.includes('fukushima') ||
          clean.includes('aomori') ||
          clean.includes('akita')
        );
      }
      if (q === 'sasmex') {
        const sasmexCodes = [9, 12, 20, 16, 21, 17, 14, 6, 7, 30, 15];
        return (
          sasmexCodes.includes(code) ||
          [
            'distrito federal',
            'guerrero',
            'oaxaca',
            'michoacan',
            'puebla',
            'morelos',
            'jalisco',
            'colima',
            'chiapas',
            'veracruz',
            'mexico',
          ].some((s) => clean.includes(s))
        );
      }
      return clean.includes(q) || rawName.includes(q) || String(code) === q;
    });
  }

  /**
   * Sectorización de alertas sísmicas mediante cajas delimitadoras (Bounding Boxes / Polígonos).
   * Cuando el algoritmo calcula que la intensidad esperada superará el umbral,
   * resalta únicamente los cuadros afectados en lugar de dibujar radios circulares perfectos.
   * Esto permite emitir advertencias precisas por prefectura o subregión (como Morioka y la costa).
   * Desaparecen de inmediato cuando el evento es confirmado.
   */
  updateAlertSectorization() {
    // Si no hay evento ni alerta activa, o si el evento ya fue confirmado, limpiar y salir
    if (!this.state.activeEvent && !this.state.activeAlert) {
      if (this.state.alertBoxes && this.state.alertBoxes.length > 0) this.state.alertBoxes = [];
      return;
    }

    // Regla crucial: "desaparecer cuando se confirme el evento"
    if (this.state.activeEvent && (this.state.activeEvent.confirmed || this.state.activeEvent.status === 'CONFIRMED')) {
      if (this.state.alertBoxes && this.state.alertBoxes.length > 0) this.state.alertBoxes = [];
      return;
    }

    if (!this.maps.boxes || !this.maps.boxes.features) {
      return;
    }

    const ev = this.state.activeEvent;
    const alert = this.state.activeAlert;
    const thresholdInt = this.sectorAlertThreshold ? this.sectorAlertThreshold.minInt : 3;

    const affectedBoxes = [];

    for (const feature of this.maps.boxes.features) {
      const props = feature.properties || {};
      const bbox = props.bbox; // [minLon, minLat, maxLon, maxLat]
      if (!bbox || bbox.length < 4) continue;

      const [minLon, minLat, maxLon, maxLat] = bbox;
      const centerLon = (minLon + maxLon) / 2;
      const centerLat = (minLat + maxLat) / 2;

      let expectedInt = 0;
      let expectedPga = 0;
      let isAffected = false;
      let reason = '';

      // 1. Evaluación si hay un evento sísmico en curso (Cálculo de intensidad esperada)
      if (ev) {
        const dLat = (centerLat - ev.lat) * 111.0;
        const dLon = (centerLon - ev.lon) * 111.0 * Math.cos(((centerLat + ev.lat) / 2 * Math.PI) / 180);
        const distKm = Math.hypot(dLat, dLon);
        const depth = ev.depth || 15;
        const hypDistKm = Math.hypot(distKm, depth);

        // Fórmulas de atenuación sísmica para PGA e Intensidad MMI / Shindo esperada
        const atten = 1 / (1 + (hypDistKm / 45));
        const calcPga = Math.max(0.01, Math.pow(10, ev.mag * 0.44 - 2.1) * atten);
        const calcInt = pgaToMercalli(calcPga);

        // También verificar si el epicentro está contenido directamente dentro del bounding box
        const containsEpicenter = (ev.lon >= minLon && ev.lon <= maxLon && ev.lat >= minLat && ev.lat <= maxLat);

        // O si alguna estación dentro de la caja tiene sacudida por encima del umbral
        const hasTriggeredStation = this.stations.some(st => {
          const sLon = st.lon ?? st.longitude;
          const sLat = st.lat ?? st.latitude;
          if (sLon >= minLon && sLon <= maxLon && sLat >= minLat && sLat <= maxLat) {
            const stInt = st.simInt || st.int || 0;
            const stPga = st.simPga || st.pga || 0;
            return stInt >= thresholdInt || stPga >= 1.5;
          }
          return false;
        });

        if (calcInt >= thresholdInt || containsEpicenter || hasTriggeredStation) {
          isAffected = true;
          expectedInt = Math.max(calcInt, containsEpicenter ? Math.max(calcInt, 4) : 0);
          expectedPga = calcPga;
          reason = containsEpicenter ? 'Epicentro en sector' : `Intensidad calculada >= ${thresholdInt}`;
        }
      }

      // 2. Evaluación si hay una alerta sísmica declarada con estados/regiones asociadas
      if (alert && !isAffected) {
        if (this.matchesAlertState(feature, alert.estados)) {
          isAffected = true;
          expectedInt = Math.max(expectedInt, 5);
          reason = 'Sector en alerta oficial declarada';
        }
      }

      if (isAffected) {
        affectedBoxes.push({
          id: props.id || props.name,
          name: props.name || props.prefecture || props.id,
          region: props.region,
          country: props.country,
          feature,
          expectedInt,
          expectedPga,
          reason,
        });
      }
    }

    this.state.alertBoxes = affectedBoxes;
  }

  /**
   * Renderiza las cajas delimitadoras (Bounding Boxes / Polígonos) de sectorización de alertas
   * Parpadean intensamente mientras la alerta está activa en fase preliminar/advertencia
   * y desaparecen de inmediato cuando el evento se confirma.
   */
  renderAlertBoundingBoxes(ctx, w, h) {
    if (!this.state.alertBoxes || this.state.alertBoxes.length === 0) return;
    if (this.state.activeEvent && (this.state.activeEvent.confirmed || this.state.activeEvent.status === 'CONFIRMED')) return;

    const now = performance.now();
    // Parpadeo tipo alerta (2.5 Hz con ciclo On del 65% para máxima visibilidad)
    const blinkCycle = (now % 400) / 400; // 0 a 1 cada 400ms
    const isBlinkOn = blinkCycle < 0.65; // On durante el 65% del ciclo

    ctx.save();

    for (const box of this.state.alertBoxes) {
      const feat = box.feature;
      if (!feat || !feat.geometry) continue;

      const geom = feat.geometry;
      const polygons =
        geom.type === 'Polygon'
          ? [geom.coordinates]
          : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : [];

      const intLevel = box.expectedInt || (this.state.activeAlert ? 5 : 4);
      const color = this.intensityColors[Math.min(intLevel, this.intensityColors.length - 1)] || '#ff2626';

      for (const poly of polygons) {
        for (const ring of poly) {
          if (!ring || ring.length < 3) continue;

          ctx.beginPath();
          const first = this.geoToCanvas(ring[0][0], ring[0][1], w, h);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < ring.length; i++) {
            const pt = this.geoToCanvas(ring[i][0], ring[i][1], w, h);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();

          // 1. Relleno parpadeante translúcido
          ctx.fillStyle = color;
          ctx.globalAlpha = isBlinkOn ? 0.38 : 0.08;
          ctx.fill();

          // 2. Borde exterior grueso parpadeante (Alerta de Sector)
          ctx.strokeStyle = color;
          ctx.lineWidth = isBlinkOn ? 4.5 : 2.0;
          ctx.globalAlpha = isBlinkOn ? 1.0 : 0.40;
          ctx.stroke();

          // 3. Borde interior contrastado en blanco
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = isBlinkOn ? 2.0 : 1.0;
          ctx.globalAlpha = isBlinkOn ? 0.95 : 0.30;
          ctx.stroke();
        }
      }

      // 4. Etiqueta del sector / subregión afectada con fondo tipo pill
      if (feat.properties && feat.properties.bbox) {
        const [minLon, minLat, maxLon, maxLat] = feat.properties.bbox;
        const centerPt = this.geoToCanvas((minLon + maxLon) / 2, (minLat + maxLat) / 2, w, h);

        ctx.save();
        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        const labelText = (box.name || 'SECTOR EN ALERTA').toUpperCase();
        const textWidth = ctx.measureText(labelText).width;
        const boxW = textWidth + 16;
        const boxH = 22;

        ctx.globalAlpha = isBlinkOn ? 0.95 : 0.50;
        ctx.fillStyle = 'rgba(10, 15, 25, 0.88)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        const bx = centerPt.x - boxW / 2;
        const by = centerPt.y - boxH / 2;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, boxW, boxH, 4);
        } else {
          ctx.rect(bx, by, boxW, boxH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isBlinkOn ? '#ffffff' : color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, centerPt.x, centerPt.y);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /**
   * Renderiza el contorno coloreado y resplandor de los estados según el nivel de alerta sísmica
   */
  renderAlertStateContours(ctx, w, h) {
    if (!this.state.activeAlert || !this.maps.mexico || !this.maps.mexico.features) return;

    const alert = this.state.activeAlert;
    const alertColor = alert.color || '#ff2626';

    // Animación suave de pulsación continua (60 FPS)
    const t = performance.now() * 0.007;
    const pulse = Math.sin(t) * 0.28 + 0.72; // Rango 0.44 a 1.0
    const outerWidth = Math.sin(t) * 2.0 + 5.0; // 3.0 a 7.0 px de grosor dinámico
    const innerWidth = 2.4;

    ctx.save();

    for (const feature of this.maps.mexico.features) {
      if (!this.matchesAlertState(feature, alert.estados)) continue;

      const geom = feature.geometry;
      if (!geom) continue;

      const polygons =
        geom.type === 'Polygon'
          ? [geom.coordinates]
          : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : [];

      for (const poly of polygons) {
        for (const ring of poly) {
          if (!ring || ring.length < 3) continue;

          ctx.beginPath();
          const first = this.geoToCanvas(ring[0][0], ring[0][1], w, h);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < ring.length; i++) {
            const pt = this.geoToCanvas(ring[i][0], ring[i][1], w, h);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();

          // 1. Relleno suave con tinte de alerta
          ctx.fillStyle = alertColor;
          ctx.globalAlpha = 0.14 * pulse;
          ctx.fill();

          // 2. Resplandor / Contorno exterior difuso en color de la alerta
          ctx.globalAlpha = 0.85 * pulse;
          ctx.strokeStyle = alertColor;
          ctx.lineWidth = outerWidth;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();

          // 3. Borde nítido contrastado en blanco para alta definición visual
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = innerWidth;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /**
   * Genera un tipo de pulso/onda radar concéntrica en las estaciones (desde el centro de la estación).
   * El pulso indica la amplitud y nivel de intensidad Mercalli detectado.
   *
   * REGLAS ESTRICTAS:
   * 1. No se activa en estaciones que pertenezcan a la Red AM (Raspberry Shake).
   * 2. SOLO SE ACTIVARÁ UNA VEZ Y SOLO SERÁ UN PULSO por escalón (Tier):
   *    - Tier 1: Mercalli 1 - 2 (Amplitud leve -> color MMI 1/2 y sonido mm1/mm2)
   *    - Tier 2: Mercalli 3 - 4 (Amplitud moderada -> color MMI 3/4 y sonido mm_3_4)
   *    - Tier 3: Mercalli 5 - 6 (Amplitud fuerte -> color MMI 5/6 y sonido mm_5_6)
   *    - Tier 4: Mercalli 7 - 8 (Amplitud muy fuerte -> color MMI 7/8 y sonido mm_7_8)
   *    - Tier 5: Mercalli 9 - 10 (Amplitud extrema -> color MMI 9/10 y sonido mm_9_10)
   *    Si otra estación detecta una intensidad igual dentro del mismo tier, NO vuelve a activarse
   *    hasta que alguna estación detecte una intensidad Mercalli superior.
   */
  checkAndTriggerStationIntensityPulse(station, intensity, pga = 0) {
    if (!station || !intensity || intensity < 1) return;

    // 1. Filtrar estaciones de la red AM (Raspberry Shake) con helper canónico (Item 32)
    if (SeismicMonitorEngine.isRaspberryShake(station)) {
      return;
    }

    // 1.5 Comparación combinada de PGA y STA/LTA con filtro de ruido basal estricto
    const isSim = Boolean(this.state.activeEvent && this.state.simulationMode);
    const stRatio = Number(station.staLtaRatio || (station.staLta && station.staLta.ratio) || 1.0);
    const stTrig = Boolean(station.triggered || station.staltaTriggered);
    const isIG = SeismicMonitorEngine.isMexicanIG(station);
    const isSV = SeismicMonitorEngine.isElSalvador(station);
    if (!isSim && !this.state.activeEvent) {
      if (!SeismicMonitorEngine.isSeismicMotion(pga, stRatio, stTrig, false, isIG, isSV)) {
        return; // Descartar pulso y sonido: ruido basal o sin congruencia PGA + STA/LTA
      }
    }

    // 2. Clasificación por Tiers de Intensidad Mercalli
    let tier = 0;
    if (intensity >= 9) tier = 5;       // Mercalli IX - X+
    else if (intensity >= 7) tier = 4;  // Mercalli VII - VIII
    else if (intensity >= 5) tier = 3;  // Mercalli V - VI
    else if (intensity >= 3) tier = 2;  // Mercalli III - IV
    else if (intensity >= 1) tier = 1;  // Mercalli I - II

    if (tier <= 0) return;

    // Regla estricta contra falsas alarmas de sonido mm_9_10 / mm_7_8 en actividad normal:
    // Si la actividad sísmica es normal (sin sismo activo confirmado en propagación),
    // una estación de El Salvador (o cualquier estación aislada) NO debe activar sonidos de
    // catástrofe destructiva (Tier 5: mm_9_10 o Tier 4: mm_7_8) provocados por señales fuertes anómalas.
    const isConfirmedSeismicEvent = Boolean(this.state.activeEvent && (this.state.activeEvent.confirmed || this.state.activeEvent.status === 'CONFIRMED' || this.state.simulationMode));
    if (!isConfirmedSeismicEvent) {
      if (isSV && tier >= 4) {
        // En actividad normal, descartar activación sonora de mm_9_10 y mm_7_8 para estaciones de El Salvador
        return;
      }
      if (tier >= 5) {
        // En actividad normal, ninguna estación aislada puede disparar mm_9_10 sin confirmación de sismo
        return;
      }
    }

    // 3. Regla de activación por estación (Item 16 & Solicitud de usuario):
    // EL PULSO SOLO SALE CADA DOS INTENSIDADES (mm1_2, mm3_4, mm5_6, mm7_8, mm9_10)
    // Y SOLO UNA VEZ POR INTENSIDAD POR ESTACIÓN.
    // Si la intensidad es mayor, se activa nuevamente según la intensidad mayor.
    const stKey = (station.code || station.id || 'STATION').toUpperCase();
    const now = performance.now();
    const stRecord = this.stationPulsedTiers ? this.stationPulsedTiers.get(stKey) : null;

    if (stRecord) {
      const isEventActive = Boolean(this.state.activeEvent);
      const isCooledDown = !isEventActive && (now - stRecord.timestamp > 60000) && (pga < 0.05);
      if (!isCooledDown && tier <= stRecord.tier) {
        return;
      }
    }

    // Registrar nuevo nivel alcanzado para esta estación con timestamp
    if (this.stationPulsedTiers) {
      this.stationPulsedTiers.set(stKey, { tier, timestamp: now });
    }
    this.highestPulsedTier = Math.max(this.highestPulsedTier, tier);

    // 4. Paleta cromática oficial MMI
    const mmiRgb = {
      1: { r: 0, g: 122, b: 255 },    // MM 1: #007aff (Azul eléctrico)
      2: { r: 0, g: 212, b: 186 },    // MM 2: #00d4ba (Cian / Turquesa)
      3: { r: 5, g: 150, b: 105 },    // MM 3: #059669 (Verde esmeralda equilibrado)
      4: { r: 249, g: 115, b: 22 },   // MM 4: #f97316 (Naranja brillante)
      5: { r: 255, g: 210, b: 0 },    // MM 5: #ffd200 (Amarillo cálido)
      6: { r: 234, g: 88, b: 12 },    // MM 6: #ea580c (Naranja rojizo fuerte)
      7: { r: 255, g: 38, b: 38 },    // MM 7: #ff2626 (Rojo brillante)
      8: { r: 190, g: 15, b: 15 },    // MM 8: #be0f0f (Rojo oscuro)
      9: { r: 136, g: 14, b: 79 },    // MM 9: #880e4f (Carmesí violento)
      10: { r: 168, g: 85, b: 247 }  // MM 10+: #a855f7 (Púrpura / Violeta)
    };

    const colorConfig = mmiRgb[intensity] || (tier === 5 ? mmiRgb[10] : mmiRgb[tier * 2]) || mmiRgb[1];

    // Radio (tamaño) fijo según el escalón de intensidad (cada 2 intensidades)
    // mm1_2: 20px, mm3_4: 32px, mm5_6: 46px, mm7_8: 62px, mm9_10: 80px
    const tierRadii = {
      1: 20,
      2: 32,
      3: 46,
      4: 62,
      5: 80
    };
    const pulseRadius = tierRadii[tier] || 20;

    // 5. Reproducir el sonido correspondiente a la intensidad
    if (this.audioManager) {
      this.audioManager.playStationIntensityPulseSound(tier, intensity);
    }

    // Si la intensidad detectada supera la intensidad MODERADA (Mercalli > 4), reproducir meow.mp3 una sola vez
    if (intensity > 4) {
      this.checkAndPlayModerateExceededMeow(this.state.activeEvent, intensity);
    }

    // 6. Generar el pulso transparente estático (sin expansión) en la estación emisora
    // REGLA SOLICITADA: "el pulso es transparente pero ya no se expande solo aparece y desaparece desvaneciendose"
    if (this.stationPulses) {
      // Si la estación ya tenía un pulso activo, se reemplaza para que el de mayor intensidad tome el relevo
      this.stationPulses = this.stationPulses.filter(p => p.stationKey !== stKey);

      this.stationPulses.push({
        stationKey: stKey,
        lat: Number(station.lat),
        lon: Number(station.lon),
        tier: tier,
        intensity: intensity,
        radius: pulseRadius,
        color: colorConfig,
        startTime: now,
        duration: 1600, // 1.6 segundos total de animación (aparición y desvanecimiento progresivo)
        lineWidth: Math.max(2.0, 1.8 + tier * 0.3),
        maxStrokeOpacity: 0.85,
        maxFillOpacity: 0.30
      });
    }
  }

  /**
   * Renderiza los pulsos transparentes en las estaciones según su nivel de intensidad (MMI)
   * REGLAS:
   * 1. El pulso es transparente (relleno y contorno con canal alfa).
   * 2. NO se expande (conserva su tamaño fijo según la intensidad detectada).
   * 3. Solo aparece y desaparece desvaneciéndose progresivamente.
   */
  renderStationPulses(ctx, w, h) {
    if (!this.stationPulses || this.stationPulses.length === 0) return;

    const now = performance.now();

    for (let i = this.stationPulses.length - 1; i >= 0; i--) {
      const p = this.stationPulses[i];
      const elapsed = now - p.startTime;

      // Al expirar el tiempo de vida del pulso, se retira de la lista
      if (elapsed >= p.duration || elapsed < 0) {
        this.stationPulses.splice(i, 1);
        continue;
      }

      // Proyectar desde las coordenadas geográficas de la estación
      const pt = this.geoToCanvas(p.lon, p.lat, w, h);
      const x = pt.x;
      const y = pt.y;

      // Factor de escala sutil según el nivel de zoom
      const zoomScale = Math.max(0.85, Math.min(1.8, Math.pow(this.zoom, 0.22)));
      const drawRadius = p.radius * zoomScale;

      if (x < -drawRadius || x > w + drawRadius || y < -drawRadius || y > h + drawRadius) {
        continue;
      }

      // Curva de opacidad:
      // Aparición suave en los primeros instantes (0.0 a 0.12)
      // Desvanecimiento progresivo suave hasta 0.0 (0.12 a 1.0)
      const progress = Math.min(1.0, Math.max(0.0, elapsed / p.duration));
      let alphaFactor;
      if (progress < 0.12) {
        alphaFactor = progress / 0.12;
      } else {
        alphaFactor = Math.pow(1.0 - (progress - 0.12) / 0.88, 1.4);
      }

      const strokeOpacity = Math.max(0, Math.min(1, alphaFactor * (p.maxStrokeOpacity || 0.85)));
      const fillOpacity = Math.max(0, Math.min(1, alphaFactor * (p.maxFillOpacity || 0.30)));

      ctx.save();

      // Relleno translúcido
      if (fillOpacity > 0.005) {
        ctx.beginPath();
        ctx.arc(x, y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${fillOpacity})`;
        ctx.fill();
      }

      // Borde exterior definido y translúcido
      if (strokeOpacity > 0.005) {
        ctx.beginPath();
        ctx.arc(x, y, drawRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${strokeOpacity})`;
        ctx.lineWidth = p.lineWidth || 2.2;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /**
   * Mapea un estado sísmico a un valor continuo (0.0 a 10.0) usando Wald et al. (1999) (Item 25 & 26)
   * para generar una interpolación cromática suave, fluida y sin desfasajes de color.
   */
  getContinuousIntensityValue(st) {
    if (!st) return 0.0;
    const isSim = Boolean(this.state.activeEvent && this.state.simulationMode);
    const pga = Number(isSim && st.simPga !== undefined ? st.simPga : (st.pga !== undefined ? st.pga : (st.acceleration || 0)));
    const intVal = Number(isSim && st.simInt !== undefined ? st.simInt : (st.int !== undefined ? st.int : (st.intensity || 0)));
    const isTriggered = Boolean(isSim ? st.simStaltaTriggered : (st.staltaTriggered || st.triggered));
    const ratio = Number(st.staLtaRatio || (st.staLta && st.staLta.ratio) || 1.0);
    const isSV = SeismicMonitorEngine.isElSalvador(st);

    // Color de aceleración en tiempo real (mantenido para red AM y todas las estaciones):
    // La estación refleja su color de aceleración según el PGA / Intensidad Mercalli
    if (pga >= 0.05) {
      const cMmi = pgaToContinuousMmi(pga);
      if (isSV && !this.state.activeEvent && cMmi >= 6.5) {
        return Math.min(3.5, cMmi);
      }
      return cMmi;
    }
    if (intVal >= 1) {
      if (isSV && !this.state.activeEvent && intVal >= 7) {
        return 3.0;
      }
      return Math.min(10.0, intVal);
    }
    if (isTriggered && ratio >= 3.0) {
      return 1.0;
    }
    return 0.0;
  }

  /**
   * Evalúa la posición exacta en el gradiente de paradas de color MMI / Kyoshin
   */
  evaluateColorAtValue(v) {
    const stops = STATION_COLOR_STOPS;
    if (v <= stops[0].val) return { r: stops[0].r, g: stops[0].g, b: stops[0].b };
    if (v >= stops[stops.length - 1].val) {
      const last = stops[stops.length - 1];
      return { r: last.r, g: last.g, b: last.b };
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i];
      const s2 = stops[i + 1];
      if (v >= s1.val && v <= s2.val) {
        const span = s2.val - s1.val;
        const frac = span > 0 ? (v - s1.val) / span : 0;
        return {
          r: Math.round(s1.r + (s2.r - s1.r) * frac),
          g: Math.round(s1.g + (s2.g - s1.g) * frac),
          b: Math.round(s1.b + (s2.b - s1.b) * frac),
        };
      }
    }
    return { r: stops[0].r, g: stops[0].g, b: stops[0].b };
  }

  /**
   * Actualiza e interpola suavemente los colores RGB de cada estación en cada frame.
   * Evita saltos bruscos y produce una transición natural, sutil y orgánica ("leve no tan directo").
   */
  updateStationColors(dt) {
    const frameDt = Math.max(0.001, Math.min(dt || 0.016, 0.1));

    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      const targetVal = this.getContinuousIntensityValue(st);
      const targetRgb = this.evaluateColorAtValue(targetVal);

      if (st.currR === undefined || st.currG === undefined || st.currB === undefined) {
        st.currR = targetRgb.r;
        st.currG = targetRgb.g;
        st.currB = targetRgb.b;
        st.currVal = targetVal;
      } else {
        // Tasa de transición suave y asimétrica:
        // Reacciona adecuadamente ante el arribo de la onda y se disipa suavemente sin cortes directos
        const isRising = targetVal > (st.currVal || 0);
        const speed = isRising ? 4.8 : 2.0;
        const lerpFactor = 1 - Math.exp(-frameDt * speed);

        st.currR += (targetRgb.r - st.currR) * lerpFactor;
        st.currG += (targetRgb.g - st.currG) * lerpFactor;
        st.currB += (targetRgb.b - st.currB) * lerpFactor;
        st.currVal = (st.currVal || 0) + (targetVal - (st.currVal || 0)) * lerpFactor;
      }

      const r = Math.min(255, Math.max(0, Math.round(st.currR)));
      const g = Math.min(255, Math.max(0, Math.round(st.currG)));
      const b = Math.min(255, Math.max(0, Math.round(st.currB)));
      st.displayColor = `rgb(${r}, ${g}, ${b})`;
    }
  }

  /**
   * Obtiene el color correspondiente a la estación sísmica:
   * Retorna el color suavizado/interpolado en tiempo real.
   */
  getStationColor(st) {
    if (!st) return "#001ee0";
    if (st.displayColor) return st.displayColor;
    const v = this.getContinuousIntensityValue(st);
    const rgb = this.evaluateColorAtValue(v);
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  /**
   * Dibuja el Anillo de Estado alrededor de una estación sísmica reactiva:
   * - Movimiento de sismo real: Anillo amarillo brillante (#ffd600) / naranja / rojo según intensidad.
   * - Movimiento algo anormal: Anillo verde lima brillante (#00e676 / #39ff14).
   * - Parpadeo (aparecer y desaparecer): Pulsación rítmica mientras dure la aceleración.
   * - Una vez que la aceleración termine y retorne a niveles basales, desaparece por completo.
   */
  /**
   * Dibuja el Anillo de Estado alrededor de una estación sísmica reactiva:
   * - Ignora estaciones de la red AM.
   * - Solo deben tener un anillo exterior concéntrico.
   * - Color verde brillante (#00e676 / #00ff66) tanto para aceleración mayor como para aceleración leve.
   * - Mantiene el color de intensidad propio de la estación en su marcador central.
   * - Parpadeo cada un segundo (periodo de 1s: 500ms visible, 500ms invisible).
   * - Una vez que la aceleración termine y decaiga a reposo, desaparece por completo.
   */
  drawStationStatusRing(ctx, sx, sy, st, stationRadius, now, isShowingIntensityNumber = false) {
    if (!st || !ctx) return;

    // 1. IGNORAR ESTACIONES DE LA RED AM
    if (SeismicMonitorEngine.isRaspberryShake(st) || (st.network && st.network.toUpperCase() === 'AM')) {
      return;
    }

    const stKey = (st.code || st.id || '').toUpperCase();
    const isSim = Boolean(this.state.activeEvent && this.state.simulationMode);
    const isRealQuake = Boolean(
      this.state.activeEvent && 
      (this.state.activeEvent.confirmed || this.state.activeEvent.status === 'CONFIRMED' || this.state.simulationMode)
    );

    // Si la estación fue ignorada temporalmente en la UI por 1 minuto debido a ruido continuo sin sismo confirmado:
    if (!isRealQuake && this.stationUIMutedUntil && this.stationUIMutedUntil.has(stKey)) {
      if (now < this.stationUIMutedUntil.get(stKey)) {
        return; // Ignorada en la UI
      }
    }
    const currentPga = Number(isSim && st.simPga !== undefined ? st.simPga : (st.pga !== undefined ? st.pga : (st.acceleration || 0)));
    const currentInt = Number(isSim && st.simInt !== undefined ? st.simInt : (st.int !== undefined ? st.int : (st.intensity || 0)));
    const isStTriggered = Boolean(isSim ? st.simStaltaTriggered : (st.triggered || st.staltaTriggered));
    const currentRatio = Number(st.staLtaRatio || (st.staLta && st.staLta.ratio) || 1.0);

    const isIG = SeismicMonitorEngine.isMexicanIG(st);
    const isSV = SeismicMonitorEngine.isElSalvador(st);

    // 2. Condición funcional estricta:
    // Una vez que la aceleración termine y retorne al nivel basal de reposo (< 0.06 gal y sin disparo),
    // el anillo desaparece por completo.
    const isAccelerationActive = currentPga >= 0.06 || (isStTriggered && currentPga >= 0.035);
    if (!isAccelerationActive) {
      return;
    }

    // Comprobar si hay movimiento sísmico real o aceleración perceptible
    const isQuakeMotion = isRealQuake && (
      isShowingIntensityNumber ||
      (st.swaveHitTime && (now - st.swaveHitTime < 60000) && currentPga >= 0.05) ||
      (currentInt >= 1 && SeismicMonitorEngine.isSeismicMotion(currentPga, currentRatio, isStTriggered, false, isIG, isSV))
    );

    const hasAbnormalMotion = isStTriggered || 
      SeismicMonitorEngine.isSeismicMotion(currentPga, currentRatio, isStTriggered, false, isIG, isSV) ||
      (currentPga >= 0.08);

    if (!isQuakeMotion && !hasAbnormalMotion) {
      return;
    }

    // 3. COLOR DEL ANILLO:
    // Solicitado por el usuario: "que se muestre ahora solo los circulos naranjas"
    // Todos los anillos de estado alrededor de los círculos de las estaciones son ahora exclusivamente naranjas
    const ringColor = "#ff9100"; // Naranja vibrante exclusivo (#ff9100)

    // 4. PARPADEO CADA UN SEGUNDO:
    // Periodo exacto de 1 segundo (1000 ms): 500 ms visible, 500 ms invisible
    const isBlinkOn = (Math.floor(now / 500) % 2) === 0;
    if (!isBlinkOn) return;

    // 5. ANILLO ALREDEDOR DEL CÍRCULO DE LA ESTACIÓN (SOLO CÍRCULOS NARANJAS):
    // Dibujar exactamente un solo anillo exterior concéntrico directamente alrededor del círculo de la estación
    ctx.save();
    const ringRadius = stationRadius + 2.4;
    ctx.beginPath();
    ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renderizado de Estaciones Sísmicas Reactivas:
   * 1. Los pulsos, ondas y halos se dibujan POR DEBAJO de las estaciones.
   * 2. Las estaciones mantienen su tamaño, forma circular y estilo idéntico.
   * 3. En estado normal son de color azul sismológico profundo (#001ee0).
   * 4. Cambian de color suavemente según su amplitud o PGA en tiempo real con transición gradual.
   * 5. EL NÚMERO DE INTENSIDAD SOLO SALE CUANDO SE CONFIRME UN SISMO.
   */
  renderStations(ctx, w, h) {
    const isConfirmedEarthquake = Boolean(this.state.activeEvent && this.state.mode !== "NORMAL");
    const isSim = Boolean(this.state.activeEvent && this.state.simulationMode);
    const isLiveActive = this.hasActiveShakingDetection();
    const lastEvent = (!isLiveActive && this.state.lastSavedEvent) ? this.state.lastSavedEvent : null;
    const recordedMap = lastEvent ? (lastEvent.recordedStations || {}) : null;
    const now = performance.now();

    // 1. Filtrar estaciones visibles y activas
    const visibleList = [];
    const activeEv = this.state.activeEvent;
    const isEventActive = Boolean(activeEv);
    const activeRecordedMap = (isEventActive && activeEv.recordedStations) ? activeEv.recordedStations : null;

    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      const stCode = (st.code || '').trim().toUpperCase();
      const fullCode = (st.fullCode || '').trim().toUpperCase();
      const isRecordedInSaved = Boolean(recordedMap && (recordedMap[stCode] || recordedMap[fullCode] || recordedMap[st.code]));
      const isRecordedInActive = Boolean(activeRecordedMap && (activeRecordedMap[stCode] || activeRecordedMap[fullCode] || activeRecordedMap[st.code]));
      const hasEventInt = Boolean(st.maxEventInt && st.maxEventInt >= 1);

      // Si no es simulación y no tiene registro en evento activo ni en el guardado, y no tiene paquetes, omitir
      if (!isSim && !isRecordedInActive && !hasEventInt && !isRecordedInSaved && (!st.packetCount || st.packetCount <= 0 || st.status === 'Sin datos')) {
        continue;
      }
      const pt = this.geoToCanvas(st.lon, st.lat, w, h);
      const sx = pt.x;
      const sy = pt.y;

      if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
      visibleList.push({ st, sx, sy, isRecordedInSaved });
    }

    // =========================================================================
    // CAPA 1 (INFERIOR): HALOS, ONDAS DE CHOQUE Y PULSOS SUBYACENTES
    // Activos exclusivamente durante detección en vivo / sismo en curso
    // =========================================================================
    if (isLiveActive) {
      visibleList.forEach(({ st, sx, sy }) => {
        ctx.save();

        // Anillo de estación seleccionada en el oscilograma Swarm
        if (this.selectedStation && this.selectedStation.code === st.code) {
          const pulse = 1 + Math.sin(now / 180) * 0.15;
          ctx.beginPath();
          ctx.arc(sx, sy, 14 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = "#00d4ba";
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }

        ctx.restore();
      });
    }

    // =========================================================================
    // CAPA 2 (SUPERIOR): CUERPOS Y MARCADORES DE ESTACIÓN
    // Modo 1 (Vivo): Círculos de telemetría y números durante sismo confirmado
    // Modo 2 (Vista de Intensidades / Reposo): Como en el monitor japonés,
    // las estaciones que registraron el último evento se muestran con un cuadrado
    // redondeado (squircle) con el número de intensidad y color Mercalli.
    // Las demás estaciones se muestran como puntos azules normales.
    // =========================================================================
    visibleList.forEach(({ st, sx, sy }) => {
      ctx.save();
      const stationColor = this.getStationColor(st);

      if (isLiveActive) {
        // =====================================================================
        // MODO VIVO / ACTIVO: Evento en progreso o detección de sacudida
        // REGLA SOLICITADA POR EL USUARIO:
        // "cuando alla un sismo confirmado las estaciones deben de mostrar la intensidad maxima que registraron, y cambiar para mayor que se actualize"
        // =====================================================================
        const isAm = SeismicMonitorEngine.isRaspberryShake(st);
        const effectiveInt = isSim 
          ? Number(st.simInt || 0) 
          : Math.max(Number(st.int || 0), pgaToMercalli(Number(st.pga || 0)));

        let isShowingIntensityNumber = false;
        let displayInt = 0;

        if (this.state.activeEvent && !isAm) {
          const ev = this.state.activeEvent;
          const stCode = (st.code || '').trim().toUpperCase();
          const fullCode = (st.fullCode || '').trim().toUpperCase();

          // Distancia de la estación al epicentro del sismo actual
          const dLat = (st.lat - ev.lat) * 111.0;
          const dLon = (st.lon - ev.lon) * 111.0 * Math.cos((ev.lat * Math.PI) / 180);
          const distKm = Math.hypot(dLat, dLon);

          // Radio perceptible físico máximo según la magnitud
          const maxPerceptibleRadiusKm = Math.min(500, Math.max(30, 25 * Math.pow(1.85, (ev.mag || 3.8) - 2.5)));
          const waveArrived = distKm <= (ev.pRadiusKm || 0) + 15.0;

          // Si la estación está dentro de la zona de afectación y la onda ya arribó:
          if (distKm <= maxPerceptibleRadiusKm && waveArrived) {
            // Límite físico de intensidad a esta distancia (rechaza picos de ruido aislados)
            const maxIntAtDist = Math.max(1, Math.round((ev.mag || 3.8) * 1.35 - Math.log10(Math.max(5, distKm)) * 2.2 - 0.2));

            // 1. Obtener intensidad previamente registrada en este sismo
            let recInt = Number(st.maxEventInt || 0);
            if (ev.recordedStations) {
              const rec = ev.recordedStations[stCode] || ev.recordedStations[fullCode] || ev.recordedStations[st.code];
              if (rec && rec.int) recInt = Math.max(recInt, Number(rec.int));
            }

            // 2. Si la aceleración o intensidad actual es mayor, actualizar para mayor
            const validEffInt = Math.min(maxIntAtDist, effectiveInt);
            if (validEffInt > recInt) {
              recInt = validEffInt;
              st.maxEventInt = recInt;
              if (!ev.recordedStations) ev.recordedStations = {};
              ev.recordedStations[stCode] = {
                code: stCode,
                lat: st.lat,
                lon: st.lon,
                site: st.site || stCode,
                state: st.state,
                int: recInt,
                pga: Math.max(Number(st.pga || 0), (ev.recordedStations[stCode]?.pga || 0)),
              };
            }

            // 3. Mostrar insignia con la intensidad máxima registrada (>= 1) acotada
            if (recInt >= 1) {
              isShowingIntensityNumber = true;
              displayInt = Math.min(maxIntAtDist, recInt);
            }
          }
        }

        if (isShowingIntensityNumber && displayInt >= 1) {
          // Círculo con número de Intensidad durante el sismo confirmado (como en la foto de referencia)
          const badgeRadius = Math.max(9.0, Math.min(15.0, 11.0 * Math.pow(this.zoom, 0.2)));
          const theme = getIntensityTheme(displayInt);

          // Sombra suave bajo el círculo de intensidad
          ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
          ctx.shadowBlur = 4;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 1;

          ctx.beginPath();
          ctx.arc(sx, sy, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = theme.bg;
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.6;
          ctx.stroke();

          const badgeLabel = formatIntensity(displayInt);
          ctx.fillStyle = theme.text;
          ctx.font = `900 ${Math.round(badgeRadius * (badgeLabel.length > 2 ? 0.85 : badgeLabel.length > 1 ? 0.95 : 1.15))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(badgeLabel, sx, sy + 0.5);

          // Anillo de estado exterior reactivo a la aceleración
          this.drawStationStatusRing(ctx, sx, sy, st, badgeRadius, now, true);
        } else {
          // Icono normal estándar de estación (como las de la red AM y en reposo)
          const baseRadius = Math.max(3.2, 3.8 * Math.pow(this.zoom, 0.25));

          ctx.beginPath();
          ctx.arc(sx, sy, baseRadius, 0, Math.PI * 2);
          ctx.fillStyle = stationColor;
          ctx.fill();

          ctx.strokeStyle = "rgba(10, 18, 30, 0.65)";
          ctx.lineWidth = 0.85;
          ctx.stroke();

          // Anillo de estado exterior reactivo a la aceleración
          this.drawStationStatusRing(ctx, sx, sy, st, baseRadius, now, false);
        }
      } else {
        // =====================================================================
        // MODO RESUMEN POST-EVENTO (VISTA DE INTENSIDADES / HISTORIAL DE SISMOS):
        // Las estaciones se mantienen limpias con su punto circular sismológico estándar.
        // La intensidad máxima registrada ya NO se dibuja saturada en cada estación individual,
        // sino en el centro del estado / provincia / municipio o ciudad representativa.
        // =====================================================================
        const baseRadius = Math.max(3.2, 3.8 * Math.pow(this.zoom, 0.25));

        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = stationColor;
        ctx.fill();

        ctx.strokeStyle = "rgba(10, 18, 30, 0.65)";
        ctx.lineWidth = 0.85;
        ctx.stroke();

        // Anillo de estado exterior reactivo a la aceleración si hubiera
        this.drawStationStatusRing(ctx, sx, sy, st, baseRadius, now, false);
      }

      // Etiqueta del código de la estación seleccionada
      if (this.selectedStation && this.selectedStation.code === st.code) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(st.code, sx, sy - 16);
      }

      ctx.restore();
    });
  }

  updateStationFromSeedLink(data) {
    if (!data || !data.station) return;
    const st = this.stations.find((s) => s.code === data.station);
    if (st) {
      st.pga = data.pga;
      st.int = data.intensity;
      st.amp = data.pga * 100;
      st.lastPacketTime = data.endTime;
      st.staLtaRatio = data.staLta ? data.staLta.ratio : 1.0;
      st.triggered = data.staLta ? data.staLta.triggered : false;

      const isAm = SeismicMonitorEngine.isRaspberryShake(st);
      const isIG = SeismicMonitorEngine.isMexicanIG(st);
      const isSV = SeismicMonitorEngine.isElSalvador(st);
      const isMotion = SeismicMonitorEngine.isSeismicMotion(st.pga, st.staLtaRatio, st.triggered, isAm, isIG, isSV);
      // Las estaciones AM (Raspberry Shake) no activan el auto-zoom
      if (!isAm && isMotion && st.pga >= this.sectorAlertThreshold.minPga) {
        st.autoZoomActiveAt = performance.now();
      }

      // Si es la estación IG.PAVE y presenta saturación excesiva o picos locales de digitalizador sin sismo confirmado
      const isPAVE = (st.code || '').trim().toUpperCase() === 'PAVE';
      if (isPAVE && !this.state.activeEvent && st.pga > 1.2) {
        st.pga = Math.min(st.pga * 0.08, 0.35);
        st.int = pgaToMercalli(st.pga);
      }

      // Si es una estación de El Salvador en actividad normal y recibe una señal con intensidad excesiva (>= 7)
      // sin que haya sismo confirmado ni disparo congruente, atenuarla a nivel basal para evitar falsos pulsos
      if (isSV && !this.state.activeEvent && st.int >= 7) {
        st.int = Math.min(st.int, 3);
      }

      if (st.int >= 1 && isMotion) {
        this.checkAndTriggerStationIntensityPulse(st, st.int, st.pga);
      }

      // Si hay un evento activo confirmado, registrar solo estaciones verdaderamente cercanas y afectadas
      if (this.state.activeEvent && (this.state.activeEvent.confirmed || this.state.activeEvent.status === 'CONFIRMED')) {
        const ev = this.state.activeEvent;
        const dLat = (st.lat - ev.lat) * 111.0;
        const dLon = (st.lon - ev.lon) * 111.0 * Math.cos((st.lat * Math.PI) / 180);
        const distKm = Math.hypot(dLat, dLon);
        const maxNearRadiusKm = Math.max(120, Math.min(600, (ev.mag - 2.5) * 110));
        const isNear = distKm <= maxNearRadiusKm;
        const isWaveHit = Boolean(st.swaveHitTime > 0) || distKm <= (ev.sRadiusKm + 30);
        const stRatio = Number(st.staLtaRatio || (st.staLta && st.staLta.ratio) || 1.0);
        const hasRealSignal = SeismicMonitorEngine.isSeismicMotion(st.pga || 0, stRatio, Boolean(st.triggered), isAm, isIG, isSV);

        if (isNear && isWaveHit && hasRealSignal && st.int >= 1) {
          if (!ev.recordedStations) ev.recordedStations = {};
          const stCode = (st.code || '').trim().toUpperCase();
          const prev = ev.recordedStations[stCode];
          if (!prev || st.int > prev.int || (st.int === prev.int && (st.pga || 0) > prev.pga)) {
            ev.recordedStations[stCode] = {
              code: stCode,
              lat: st.lat,
              lon: st.lon,
              site: st.site || stCode,
              state: st.state,
              int: st.int,
              pga: Number((st.pga || 0).toFixed(3)),
            };
          }
        }
      }

      this.onStateChange(this.getStateSnapshot());
    }
  }

  syncLiveStations(stationArray) {
    if (!Array.isArray(stationArray)) return;
    const validLive = stationArray.filter((s) => s && typeof s.code === 'string' && s.code.trim().length > 0);
    const map = new Map(validLive.map((s) => [s.code.trim().toUpperCase(), s]));
    let changed = false;

    this.stations.forEach((st) => {
      const codeUpper = (st.code || '').trim().toUpperCase();
      if (!codeUpper) return;
      const live = map.get(codeUpper);
      if (live) {
        st.pga = live.pga || 0;
        st.int = live.intensity || 0;
        st.amp = live.amp || 0;
        st.lastPacketTime = live.lastPacketTime;
        st.staLtaRatio = live.staLtaRatio || 1.0;
        st.triggered = live.triggered || false;
        st.status = live.status;
        st.packetCount = live.packetCount || 0;
        changed = true;

        const isAm = SeismicMonitorEngine.isRaspberryShake(st);
        const isIG = SeismicMonitorEngine.isMexicanIG(st);
        const isSV = SeismicMonitorEngine.isElSalvador(st);
        const isMotion = SeismicMonitorEngine.isSeismicMotion(st.pga, st.staLtaRatio, st.triggered, isAm, isIG, isSV);

        // Si es la estación IG.PAVE y presenta saturación excesiva sin sismo confirmado
        const isPAVE = codeUpper === 'PAVE';
        if (isPAVE && !this.state.activeEvent && st.pga > 1.2) {
          st.pga = Math.min(st.pga * 0.08, 0.35);
          st.int = pgaToMercalli(st.pga);
        }

        if (isSV && !this.state.activeEvent && st.int >= 7) {
          st.int = Math.min(st.int, 3);
        }

        if (st.int >= 1 && isMotion) {
          this.checkAndTriggerStationIntensityPulse(st, st.int, st.pga);
        }
      }
    });

    validLive.forEach((live) => {
      const codeUpper = (live.code || '').trim().toUpperCase();
      if (!codeUpper) return;
      const lat = Number(live.lat);
      const lon = Number(live.lon);
      // Límites geográficos unificados: México, Guatemala y Honduras
      const inCoverage = !isNaN(lat) && !isNaN(lon) && lat >= 12.5 && lat <= 33.0 && lon >= -118.5 && lon <= -82.0;
      if (inCoverage && !this.stations.some((s) => (s.code || '').trim().toUpperCase() === codeUpper)) {
        this.stations.push({
          network: live.network || 'AM',
          networkName: live.network === 'AM' ? t('net.raspberry') : t('net.nationalSsn'),
          code: live.code,
          fullCode: live.fullCode || `${live.network}.${live.code}`,
          site: live.site || live.code,
          name: live.site || live.code,
          state: live.state || '',
          lat: lat,
          lon: lon,
          alt: 0,
          channelCount: 1,
          channels: [],
          primaryChannel: live.primaryChannel || 'EHZ',
          work: true,
          pga: live.pga || 0,
          amp: live.amp || 0,
          int: live.intensity || 0,
          lastPacketTime: live.lastPacketTime,
          staLtaRatio: live.staLtaRatio || 1.0,
          triggered: live.triggered || false,
          status: live.status,
          packetCount: live.packetCount || 0,
          staltaTriggered: false,
          swaveHitTime: 0,
          currR: 0,
          currG: 30,
          currB: 224,
          currVal: 0.0,
          displayColor: 'rgb(0, 30, 224)',
        });
        changed = true;
      }
    });

    if (changed) {
      this.onStateChange(this.getStateSnapshot());
    }
  }

  getSnapshot() {
    return this.getStateSnapshot();
  }

  getStateSnapshot() {
    const isSim = Boolean(this.state.activeEvent && this.state.simulationMode);
    const activeStations = this.stations.filter(
      (s) => (s.packetCount > 0 && s.status !== 'Sin datos') || (s.pga || 0) > 0 || s.triggered || (isSim && (s.simPga || 0) > 0)
    );

    // Estaciones con aceleración anormal EXCLUYENDO a las de la red AM
    // Item 17 & 19: Filtro con histeresis (latching de 15s) e incorporación de staLtaRatio (>= 4-5)
    // Item 32: Helper unificado canónico isRaspberryShake
    const nowTime = performance.now();

    // Rastreador de duración continua de aceleración por estación
    if (!this.stationActivityTimes) {
      this.stationActivityTimes = new Map();
    }
    if (!this.stationActivityCooldownUntil) {
      this.stationActivityCooldownUntil = new Map();
    }
    if (!this.stationUIMutedUntil) {
      this.stationUIMutedUntil = new Map();
    }

    // Comprobar si se ha iniciado una detección sísmica o sismo confirmado
    const isSeismicDetectionActive = Boolean(
      this.state.activeEvent && 
      (this.state.activeEvent.confirmed || 
       this.state.activeEvent.status === 'CONFIRMED' || 
       this.state.simulationMode || 
       (this.state.activeEvent.triggerCount && this.state.activeEvent.triggerCount >= 2))
    );

    // REGLA CRÍTICA: "AMENOS DE QUE SE INICIE UNA DETECCION SISMICA"
    // Si se inicia una detección sísmica, reactivar de inmediato cualquier estación previamente silenciada
    if (isSeismicDetectionActive && this.stationUIMutedUntil.size > 0) {
      this.stationUIMutedUntil.clear();
    }

    const abnormalStations = this.stations.filter((s) => {
      if (SeismicMonitorEngine.isRaspberryShake(s)) return false;
      const stKey = (s.code || s.id || '').toUpperCase();

      // Si la estación está ignorada en la UI por 1 minuto y no hay detección sísmica:
      if (!isSeismicDetectionActive && this.stationUIMutedUntil.has(stKey)) {
        const mutedUntil = this.stationUIMutedUntil.get(stKey);
        if (nowTime < mutedUntil) {
          return false; // Mantener ignorada la aceleración en la UI
        } else {
          // El minuto ya expiró: retirar del silencio
          this.stationUIMutedUntil.delete(stKey);
          this.stationActivityTimes.delete(stKey);
          this.stationActivityCooldownUntil.delete(stKey);
        }
      }

      const pga = Number(isSim && s.simPga !== undefined ? s.simPga : (s.pga || 0));
      const intVal = Number(isSim && s.simInt !== undefined ? s.simInt : (s.int || 0));
      const triggered = Boolean(isSim ? s.simStaltaTriggered : (s.triggered || s.staltaTriggered));
      const isWaveHit = Boolean(s.swaveHitTime > 0);
      const ratio = Number(s.staLtaRatio || s.ratio || (s.staLta && s.staLta.ratio) || 1.0);

      let isAbnormalNow = false;

      // Si hay un sismo activo propagándose:
      if (this.state.activeEvent) {
        const ev = this.state.activeEvent;
        const dLat = (s.lat - ev.lat) * 111.0;
        const dLon = (s.lon - ev.lon) * 111.0 * Math.cos((ev.lat * Math.PI) / 180);
        const distKm = Math.hypot(dLat, dLon);
        const maxNearRadiusKm = Math.max(120, Math.min(600, (ev.mag - 2.5) * 110));

        const isIG = SeismicMonitorEngine.isMexicanIG(s);
        const isSV = SeismicMonitorEngine.isElSalvador(s);
        // Solo estaciones cercanas al evento con arribo de onda o detección sísmica combinada real
        if (distKm <= maxNearRadiusKm) {
          isAbnormalNow = (isWaveHit && pga >= 0.15 && intVal >= 1) || 
                          SeismicMonitorEngine.isSeismicMotion(pga, ratio, triggered, false, isIG, isSV);
        }
      } else {
        const isIG = SeismicMonitorEngine.isMexicanIG(s);
        const isSV = SeismicMonitorEngine.isElSalvador(s);
        // En reposo (sin sismo activo):
        // Algoritmo de detección combinada PGA + STA/LTA con filtro estricto de ruido basal
        isAbnormalNow = SeismicMonitorEngine.isSeismicMotion(pga, ratio, triggered, false, isIG, isSV);
      }

      // Evaluar si la estación está registrando aceleración activa real (>= 0.70 gal)
      const hasAcceleration = (pga >= 0.70) && (isAbnormalNow || triggered || pga >= 0.70);

      if (hasAcceleration) {
        // La estación está dando aceleración >= 0.7 gal:
        let firstDetected = this.stationActivityTimes.get(stKey);
        if (!firstDetected) {
          firstDetected = nowTime;
          this.stationActivityTimes.set(stKey, nowTime);
        }

        const continuousDurationSec = (nowTime - firstDetected) / 1000;

        // Si se sobrepasan los 10 segundos continuos sin confirmación sísmica, silenciar por 1 minuto
        if (!isSeismicDetectionActive && continuousDurationSec >= 10.0) {
          this.stationUIMutedUntil.set(stKey, nowTime + 60000);
          this.stationActivityTimes.delete(stKey);
          this.stationActivityCooldownUntil.delete(stKey);
          return false;
        }

        // COOLDOWN / ESTABILIDAD REQUERIDA POR EL USUARIO:
        // Debe marcar aceleración por al menos 3 segundos de manera sostenida (o durante sismo activo)
        // para entrar a mostrarse en actividad, evitando que un pico de 1 instante parpadee.
        const qualifiedForActivity = isSeismicDetectionActive || continuousDurationSec >= 3.0;

        if (qualifiedForActivity) {
          // Mantener o extender el cooldown de salida por 3.5 segundos hacia adelante
          this.stationActivityCooldownUntil.set(stKey, nowTime + 3500);
          return true;
        }

        // Si aún no alcanza los 3 segundos pero ya estaba en cooldown activo previo, mantenerla
        if (this.stationActivityCooldownUntil.has(stKey)) {
          const cooldownEnd = this.stationActivityCooldownUntil.get(stKey);
          if (nowTime < cooldownEnd) {
            return true;
          }
        }

        return false;
      } else {
        // La estación ya cayó por debajo de 0.70 gal:
        this.stationActivityTimes.delete(stKey);

        // COOLDOWN DE SALIDA: Si la estación ya estaba calificada y visible, no quitarla bruscamente.
        // Se mantiene visible durante el cooldown (3.5 segundos) para que la UI no parpadee apareciendo y desapareciendo.
        if (this.stationActivityCooldownUntil.has(stKey)) {
          const cooldownEnd = this.stationActivityCooldownUntil.get(stKey);
          if (nowTime < cooldownEnd) {
            return true; // Sigue mostrándose durante el cooldown de salida
          } else {
            this.stationActivityCooldownUntil.delete(stKey);
          }
        }

        return false;
      }
    });

    return {
      mode: this.state.mode,
      activeEvent: this.state.activeEvent ? { ...this.state.activeEvent } : null,
      lastSavedEvent: this.state.lastSavedEvent ? { ...this.state.lastSavedEvent } : null,
      activeAlert: this.state.activeAlert ? { ...this.state.activeAlert } : null,
      alertBoxes: [...(this.state.alertBoxes || [])],
      maxPga: this.state.maxPga,
      highestIntensity: this.state.highestIntensity,
      realtimeMaxInt: this.state.realtimeMaxInt,
      realtimeMaxPga: this.state.realtimeMaxPga,
      topRegions: [...this.state.topRegions],
      stations: activeStations.map((s) => ({ ...s })),
      abnormalStations: abnormalStations.map((s) => ({ ...s })),
      hasAbnormalActivity: abnormalStations.length > 0,
      totalConfigured: this.stations.length,
    };
  }
}

