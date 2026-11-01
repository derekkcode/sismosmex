/**
 * GESTOR DE INTERFAZ SEEDLINK Y VISOR DE ESTACIONES EN TIEMPO REAL
 * Adquisición multi-servidor TCP (25 servidores, timeout 20s),
 * panel de estaciones sísmicas (Aceleración, Amplitud, Estado, Delay, PGA)
 * y visualizador de oscilogramas estilo USGS Swarm con STA/LTA.
 */

import { getIntensityTheme } from './monitor-engine.js';
import { t, getLocale, formatEventDate } from './i18n.js';
import { formatIntensity, getIntensityScale } from './display-settings.js';

const SWARM_MOBILE_QUERY = window.matchMedia('(max-width: 768px)');

const STATION_STATUS_KEYS = {
  'Recibiendo': 'seedlink.statusReceiving',
  'En línea': 'seedlink.statusOnline',
  'Disparo STA/LTA': 'seedlink.statusTrigger',
  'Sin datos': 'seedlink.statusNoData',
  'Reposo': 'seedlink.statusIdle'
};

// Los valores de estado se comparan en español; la etiqueta solo se traduce al mostrarla.
function stationStatusLabel(status) {
  const key = STATION_STATUS_KEYS[status];
  return key ? t(key) : status;
}

// Estados de conexión del pool: 'Done', 'Connecting', 'timed out' o texto del servidor.
function serverStatusLabel(status) {
  if (status === 'Done') return t('seedlink.statusConnected');
  if (status && status.includes('timed out')) return t('seedlink.statusTimeout');
  if (status === 'Connecting') return t('seedlink.statusConnecting');
  return status || t('seedlink.statusWaiting');
}

export const DEFAULT_GUANACASTE_INTER_EVENT = {
  id: 'eq-usgs-us6000tymj',
  displayId: 'TYMJ',
  time: '2026-09-30T21:55:26.169Z',
  timeEpoch: 1790805326169,
  detectedAt: '2026-09-30T21:55:36.169Z',
  latitude: 9.7526,
  longitude: -86.5063,
  lat: 9.7526,
  lon: -86.5063,
  depth: 8,
  magnitude: 5.6,
  mag: 5.6,
  magnitudeType: 'MWW',
  location: '94 km SW de Tamarindo, Costa Rica',
  maxPga: 6.5,
  maxIntensity: 5,
  stationCount: 0,
  stations: [],
  isInter: true,
  category: 'inter',
  status: 'CONFIRMED',
  source: 'USGS (Sismo Internacional)',
  saved: true,
  isLocked: true,
};

export const DEFAULT_LAST_EVENT = {
  id: 'eq-20260926012200-mapastepec',
  time: '2026-09-26T01:22:00-06:00',
  timeEpoch: 1790407320000,
  detectedAt: '2026-09-26T01:22:08-06:00',
  latitude: 14.81,
  longitude: -93.39,
  lat: 14.81,
  lon: -93.39,
  depth: 106,
  magnitude: 4.0,
  mag: 4.0,
  magnitudeType: 'ML',
  location: '86 km al Suroeste de Mapastepec, Chis',
  maxPga: 2.85,
  maxIntensity: 4,
  stationCount: 6,
  stations: ['PCIG', 'THIG', 'TGIG', 'CCIG'],
  recordedStations: {
    'PCIG': { code: 'PCIG', int: 4, pga: 2.85, site: 'Pijijiapan, Chis.', state: 'Chiapas', lat: 15.70462, lon: -93.21895 },
    'THIG': { code: 'THIG', int: 3, pga: 1.45, site: 'Tapachula, Chis.', state: 'Chiapas', lat: 14.8823, lon: -92.2958 },
    'TGIG': { code: 'TGIG', int: 2, pga: 0.58, site: 'Tuxtla Gutiérrez, Chis.', state: 'Chiapas', lat: 16.77821, lon: -93.12228 },
    'CCIG': { code: 'CCIG', int: 2, pga: 0.42, site: 'Comitán, Chis.', state: 'Chiapas', lat: 16.28188, lon: -92.13692 }
  },
  regionalIntensities: [
    { name: 'Chiapas', lat: 15.43, lon: -92.90, maxInt: 4, maxPga: 2.85 }
  ],
  status: 'CONFIRMED',
  source: 'Red Sísmica Nacional (Confirmado)',
  saved: true,
  isLocked: true,
};

export const INITIAL_EARTHQUAKES = [
  DEFAULT_GUANACASTE_INTER_EVENT,
  DEFAULT_LAST_EVENT,
  {
    id: 'eq-20260926012200-copan',
    time: '2026-09-26T01:22:00-06:00',
    timeEpoch: 1790407320000,
    detectedAt: '2026-09-26T01:22:08-06:00',
    latitude: 14.74,
    longitude: -89.54,
    lat: 14.74,
    lon: -89.54,
    depth: 3,
    magnitude: 3.7,
    mag: 3.7,
    magnitudeType: 'ML',
    location: '42 km al Oeste de Copán Ruinas, Copán, HN',
    maxPga: 0.15,
    maxIntensity: 1,
    stationCount: 4,
    stations: [],
    recordedStations: {
      'COPAN': { code: 'COPAN', int: 1, pga: 0.15, site: 'Copán Ruinas, Copán, HN', state: 'Copán', lat: 14.83, lon: -89.15 },
      'CHIAP': { code: 'CHIAP', int: 1, pga: 0.12, site: 'Frontera Chiapas / Guatemala', state: 'Chiapas', lat: 15.05, lon: -91.80 },
      'CCIG': { code: 'CCIG', int: 1, pga: 0.10, site: 'Comitán, Chis. MX', state: 'Chiapas', lat: 16.28188, lon: -92.13692 },
    },
    regionalIntensities: [
      { name: 'Copán', lat: 14.74, lon: -89.54, maxInt: 1, maxPga: 0.15 }
    ],
    status: 'CONFIRMED',
    source: 'Red Sísmica Regional (Confirmado)',
    saved: true,
    isLocked: true,
  },
  {
    id: 'eq-20260921050700-comitan',
    time: '2026-09-21T05:07:00-06:00',
    timeEpoch: 1790075220000,
    detectedAt: '2026-09-21T05:07:08-06:00',
    latitude: 16.251,
    longitude: -92.134,
    lat: 16.251,
    lon: -92.134,
    depth: 15,
    magnitude: 4.5,
    mag: 4.5,
    magnitudeType: 'ML',
    location: 'Cercas de comitan, Chiapas',
    maxPga: 3.42,
    maxIntensity: 3,
    stationCount: 5,
    stations: [],
    recordedStations: {
      'CCIG': { code: 'CCIG', int: 3, pga: 3.42, site: 'Comitan, Chis. MX', state: 'Chiapas', lat: 16.28188, lon: -92.13692 },
      'TGIG': { code: 'TGIG', int: 1, pga: 0.15, site: 'TUXTLA GUTIERREZ', state: 'Chiapas', lat: 16.77821, lon: -93.12228 },
      'PCIG': { code: 'PCIG', int: 1, pga: 0.12, site: 'PIJIJIAPAN', state: 'Chiapas', lat: 15.70462, lon: -93.21895 },
      'PAVE': { code: 'PAVE', int: 1, pga: 0.14, site: 'Pavencul, Tacana', state: 'Chiapas', lat: 15.1926, lon: -92.1772 },
      'PATR': { code: 'PATR', int: 1, pga: 0.13, site: 'Patria, Tacana', state: 'Chiapas', lat: 15.1185, lon: -92.2364 },
      'CHIQ': { code: 'CHIQ', int: 1, pga: 0.12, site: 'Chiquihuite, Tacana', state: 'Chiapas', lat: 15.0896, lon: -92.1049 },
    },
    status: 'CONFIRMED',
    source: 'Red Sísmica Nacional (Confirmado)',
    saved: true,
    isLocked: true,
  },
];

export class SeedLinkUIManager {
  constructor(engine) {
    this.engine = engine;
    this.ws = null;

    // Catálogos locales
    this.stations = new Map();
    this.servers = [];
    this.earthquakes = [...INITIAL_EARTHQUAKES];

    // Filtros de búsqueda
    this.stationSearchQuery = '';
    this.stationFilterMode = 'all'; // 'all' | 'online' | 'trigger' | 'ig' | 'am'

    // Estación activa en el oscilograma Swarm
    this.activeStation = null;
    this.waveformBuffer = [];
    this.activeFilter = 'local'; // Filtro local 1 - 10 Hz permanente

    // Pestaña activa en el modal SeedLink: 'stations' | 'servers'
    this.activeTab = 'stations';

    // Elementos DOM
    this.modalEl = document.getElementById('seedlinkModal');
    this.swarmPanelEl = document.getElementById('swarmPanel');

    this.waveCanvas = document.getElementById('waveformCanvas');
    this.waveCtx = this.waveCanvas ? this.waveCanvas.getContext('2d') : null;

    this.staltaCanvas = document.getElementById('staltaCanvas');
    this.staltaCtx = this.staltaCanvas ? this.staltaCanvas.getContext('2d') : null;

    // Control de versión de arranque del servidor (para refrescar a todos los clientes al actualizarse el servidor)
    this.currentServerBootId = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        this.currentServerBootId = sessionStorage.getItem('sismosmex_server_boot_id') || null;
      }
    } catch (_) {}
    this.isReloadingDueToUpdate = false;
    this.announcedTriggerStations = new Map(); // stCode -> timestamp
    this.connectionState = 'disconnected'; // 'connected' | 'slow' | 'disconnected'
    this.lastPacketReceiveTime = Date.now();
    this.onConnectionStatusChange = null;

    this.initDomEvents();
    this.initWebSocket();
    this.fetchInitialData();
    this.startSwarmRenderLoop();
    this.startPeriodicRefresh();

    // Hook al motor de mapa cuando se selecciona una estación
    this.engine.onStationSelect = (station) => {
      this.openSwarmViewer(station);
    };
    SWARM_MOBILE_QUERY.addEventListener('change', (e) => {
      if (e.matches && this.activeStation) this.closeSwarmViewer();
    });
  }

  initDomEvents() {
    // Botones del menú para abrir el panel SeedLink
    const btnMenu = document.getElementById('btnMenuSeedlink');
    const btnSidebar = document.getElementById('btnSidebarSeedlink');
    const btnToolbar = document.getElementById('btnToolbarSeedlink');

    const openModal = () => this.openSeedlinkModal();
    if (btnMenu) btnMenu.addEventListener('click', openModal);
    if (btnSidebar) btnSidebar.addEventListener('click', openModal);
    if (btnToolbar) btnToolbar.addEventListener('click', openModal);

    // Botones de cierre del modal
    const btnClose = document.getElementById('btnSeedlinkModalClose');
    const btnCancel = document.getElementById('btnSeedlinkModalCancel');
    const closeModal = () => this.closeSeedlinkModal();

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    // Cerrar con Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.modalEl && this.modalEl.classList.contains('open')) {
          this.closeSeedlinkModal();
        } else if (this.swarmPanelEl && this.swarmPanelEl.classList.contains('open')) {
          this.closeSwarmViewer();
        }
      }
    });

    // Pestañas del modal SeedLink
    const tabStations = document.getElementById('tabBtnStations');
    const tabServers = document.getElementById('tabBtnServers');
    if (tabStations) {
      tabStations.addEventListener('click', () => {
        this.switchTab('stations');
      });
    }
    if (tabServers) {
      tabServers.addEventListener('click', () => {
        this.switchTab('servers');
      });
    }

    // Buscador de estaciones
    const searchInput = document.getElementById('stationSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.stationSearchQuery = e.target.value.toLowerCase().trim();
        this.renderStationsTable();
      });
    }

    // Filtros rápidos
    document.querySelectorAll('.station-filter-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.station-filter-chip').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.stationFilterMode = e.currentTarget.getAttribute('data-filter') || 'all';
        this.renderStationsTable();
      });
    });

    // Botón de reconectar todos los servidores
    const btnReconnectAll = document.getElementById('btnSeedlinkReconnectAll');
    if (btnReconnectAll) {
      btnReconnectAll.addEventListener('click', () => {
        fetch('/api/seedlink/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).then(() => {
          this.fetchInitialData();
        }).catch(() => {});
      });
    }

    // Control de cierre del visor Swarm
    const btnSwarmClose = document.getElementById('btnSwarmClose');
    if (btnSwarmClose) btnSwarmClose.addEventListener('click', () => this.closeSwarmViewer());
  }

  openSeedlinkModal() {
    if (this.modalEl) {
      this.modalEl.classList.add('open');
      this.renderSummaryCounters();
      this.renderStationsTable();
      this.renderServersTable();
    }
  }

  closeSeedlinkModal() {
    if (this.modalEl) {
      this.modalEl.classList.remove('open');
    }
  }

  switchTab(tab) {
    this.activeTab = tab;
    const tabStations = document.getElementById('tabBtnStations');
    const tabServers = document.getElementById('tabBtnServers');
    const viewStations = document.getElementById('viewTabStations');
    const viewServers = document.getElementById('viewTabServers');

    if (tab === 'stations') {
      if (tabStations) tabStations.classList.add('active');
      if (tabServers) tabServers.classList.remove('active');
      if (viewStations) viewStations.style.display = 'flex';
      if (viewServers) viewServers.style.display = 'none';
      this.renderStationsTable();
    } else {
      if (tabStations) tabStations.classList.remove('active');
      if (tabServers) tabServers.classList.add('active');
      if (viewStations) viewStations.style.display = 'none';
      if (viewServers) viewServers.style.display = 'flex';
      this.renderServersTable();
    }
  }

  initWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${proto}//${host}/ws`;

    console.log(`[SeedLinkUI] Conectando WebSocket a ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[SeedLinkUI] WebSocket conectado con backend');
      this.setConnectionState('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        this.lastPacketReceiveTime = Date.now();
        const msg = JSON.parse(event.data);
        if (msg.type === 'seismic_data' && typeof msg.delaySec === 'number') {
          // Si el delay promedio de los paquetes supera 4.5 segundos, considerar conexión lenta
          if (msg.delaySec > 4.5) {
            this.setConnectionState('slow');
          } else {
            this.setConnectionState('connected');
          }
        }
        this.handleWsMessage(msg);
      } catch (err) {
        console.warn('[SeedLinkUI] Error parseando mensaje WS:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[SeedLinkUI] WebSocket cerrado. Reintentando en 3s...');
      this.setConnectionState('disconnected');
      setTimeout(() => this.initWebSocket(), 3000);
    };

    this.ws.onerror = () => {
      this.setConnectionState('disconnected');
    };
  }

  setConnectionState(state) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      if (typeof this.onConnectionStatusChange === 'function') {
        this.onConnectionStatusChange(state);
      }
    }
  }

  fetchInitialData() {
    this.reloadStationsAndServers();
  }

  startPeriodicRefresh() {
    // Si WebSocket está conectado, las estaciones y paquetes fluyen en tiempo real por el socket.
    // Solo consultar la API si el WebSocket NO está abierto (fallback cada 5s),
    // o como sincronización de fondo suave cada 30s sin destruir la UI.
    setInterval(() => {
      const isWsConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
      if (!isWsConnected) {
        this.reloadStationsAndServers();
      }
      // Solo sincronizar buffer histórico si el visor Swarm está abierto y aún no ha cargado puntos
      if (this.activeStation && this.swarmPanelEl && this.swarmPanelEl.classList.contains('open')) {
        if (!this.waveformBuffer || this.waveformBuffer.length === 0) {
          this.fetchStationWaveform(this.activeStation.code);
        }
      }
    }, 5000);

    // Heartbeat suave cada 30s si el WebSocket está conectado para consistencia sin parpadeos
    setInterval(() => {
      const isWsConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
      if (isWsConnected) {
        this.reloadStationsAndServers();
      }
    }, 30000);

    // Sondeo de versión del servidor para auto-refresco de clientes cuando el servidor se actualiza
    setInterval(() => {
      // Si no han entrado paquetes en los últimos 7 segundos y el WS dice open, marcar conexión lenta
      const now = Date.now();
      const elapsedSincePacket = now - this.lastPacketReceiveTime;
      const isWsConnected = this.ws && this.ws.readyState === WebSocket.OPEN;

      if (!isWsConnected) {
        this.setConnectionState('disconnected');
      } else if (elapsedSincePacket > 15000) {
        this.setConnectionState('disconnected');
      } else if (elapsedSincePacket > 6000) {
        this.setConnectionState('slow');
      }

      fetch('/api/server/version')
        .then((r) => r.json())
        .then((data) => {
          if (data && data.serverBootId) {
            this.handleServerUpdate(data.serverBootId, 'sondeo_http');
          }
        })
        .catch(() => {});
    }, 4000);
  }

  fetchStationWaveform(stationCode) {
    if (!stationCode) return;
    const clean = stationCode.includes('.') ? stationCode.split('.').pop().trim() : stationCode.trim();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_active_station', station: clean }));
      this.ws.send(JSON.stringify({ type: 'get_waveform', station: clean }));
    }

    fetch(`/api/seedlink/waveform?station=${encodeURIComponent(clean)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && Array.isArray(data.waveform) && data.waveform.length > 0) {
          const activeCode = this.activeStation ? (this.activeStation.code || '').trim().toUpperCase() : '';
          if (activeCode && (activeCode === clean.toUpperCase() || activeCode === stationCode.toUpperCase())) {
            this.mergeWaveformBuffer(data.waveform);
          }
        }
      })
      .catch(() => {});
  }

  mergeWaveformBuffer(incoming) {
    if (!incoming || !Array.isArray(incoming) || incoming.length === 0) return;
    if (!this.waveformBuffer || this.waveformBuffer.length === 0) {
      this.waveformBuffer = incoming.slice(-1500);
      return;
    }

    // Combinar los puntos sin perder los puntos en vivo más recientes
    const timeMap = new Map();
    for (let i = 0; i < incoming.length; i++) {
      const pt = incoming[i];
      if (pt && pt.time) timeMap.set(pt.time, pt);
    }
    for (let i = 0; i < this.waveformBuffer.length; i++) {
      const pt = this.waveformBuffer[i];
      if (pt && pt.time) timeMap.set(pt.time, pt);
    }

    const merged = Array.from(timeMap.values());
    merged.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    this.waveformBuffer = merged.slice(-1500);
  }

  reloadStationsAndServers() {
    // 1. Recargar datos de estaciones sísmicas
    fetch('/api/seedlink/stations')
      .then((r) => r.json())
      .then((stations) => {
        if (Array.isArray(stations)) {
          for (const st of stations) {
            this.stations.set(st.code, st);
          }
          this.engine.syncLiveStations(stations);
          this.renderSummaryCounters();
          this.updateAllStationRowsLive();
        }
      })
      .catch(() => {});

    // 2. Recargar datos de servidores SeedLink
    fetch('/api/seedlink/servers')
      .then((r) => r.json())
      .then((data) => {
        if (data && Array.isArray(data.servers)) {
          this.servers = data.servers;
          this.renderSummaryCounters();
          this.updateAllServerRowsLive();
        }
      })
      .catch(() => {});

    // 3. Recargar catálogo histórico de eventos sísmicos
    fetch('/api/seedlink/events')
      .then((r) => r.json())
      .then((events) => {
        this.earthquakes = Array.isArray(events) && events.length > 0 ? events : [...INITIAL_EARTHQUAKES];
        this.renderEarthquakeHistory();
      })
      .catch(() => {});
  }

  updateAllStationRowsLive() {
    const tbody = document.getElementById('seedlinkStationsTableBody');
    if (!tbody || tbody.children.length === 0 || tbody.querySelector('.table-empty-row')) {
      if (this.activeTab === 'stations') {
        this.renderStationsTable();
      }
      return;
    }

    this.stations.forEach((st) => {
      const elAccel = document.getElementById(`row-accel-${st.code}`);
      const elBar = document.getElementById(`row-bar-${st.code}`);
      const elAmp = document.getElementById(`row-amp-${st.code}`);
      const elStatus = document.getElementById(`row-status-${st.code}`);
      const elDelay = document.getElementById(`row-delay-${st.code}`);
      const elPga = document.getElementById(`row-pga-${st.code}`);

      const hasData = (st.packetCount > 0) && (st.status !== 'Sin datos');
      const accel = hasData ? (st.acceleration || 0) : 0;
      const accelStr = hasData ? (st.accelerationStr || `${accel.toFixed(3)} gal`) : '—';
      const ampStr = hasData ? (st.ampStr || `${(st.amp || 0).toFixed(1)} µm/s`) : '—';
      const pgaStr = hasData ? (st.pgaStr || `${(st.pga || accel).toFixed(3)} gal`) : '—';
      const delayStr = hasData ? (st.delay || '—') : '—';

      if (elAccel) elAccel.innerText = accelStr;
      if (elBar) {
        const barWidth = hasData ? Math.min(100, Math.max(3, (accel / 2.0) * 100)) : 0;
        const barColor = accel > 5.0 ? '#dc2626' : accel > 1.0 ? '#f97316' : accel > 0.1 ? '#eab308' : '#38bdf8';
        elBar.style.width = `${barWidth}%`;
        elBar.style.background = barColor;
      }
      if (elAmp) elAmp.innerText = ampStr;
      if (elStatus) {
        const statusClass = st.triggered
          ? 'status-badge-trigger'
          : (st.status === 'Recibiendo' || st.status === 'En línea')
          ? 'status-badge-online'
          : (st.status === 'Reposo')
          ? 'status-badge-idle'
          : 'status-badge-nodata';
        elStatus.className = `status-pill-badge ${statusClass}`;
        elStatus.innerHTML = `<span class="status-dot"></span> ${stationStatusLabel(st.status)}`;
      }
      if (elDelay) elDelay.innerText = delayStr;
      if (elPga) elPga.innerText = pgaStr;
    });
  }

  updateAllServerRowsLive() {
    const tbody = document.getElementById('seedlinkServersTableBody');
    if (!tbody || tbody.children.length === 0 || tbody.querySelector('.table-empty-row')) {
      if (this.activeTab === 'servers') {
        this.renderServersTable();
      }
      return;
    }

    for (const s of this.servers) {
      const elStatus = document.getElementById(`srv-status-${s.id}`);
      const elTelem = document.getElementById(`srv-telem-${s.id}`);
      if (elStatus) {
        const isDone = s.status === 'Done';
        const isTimeout = s.status && s.status.includes('timed out');
        const statusClass = isDone
          ? 'server-status-done'
          : isTimeout
          ? 'server-status-timeout'
          : 'server-status-error';
        elStatus.className = `server-status-pill ${statusClass}`;
        elStatus.innerText = serverStatusLabel(s.status);
      }
      if (elTelem) {
        elTelem.innerText = `${(s.packetsReceived || 0).toLocaleString()} pkts • ${s.bitrateKbps || 0} kbps`;
      }
    }
  }

  handleWsMessage(msg) {
    if (!msg) return;

    // 0. Orden explícita de recarga difundida por el servidor (ej. despliegue, reinicio o CLI)
    if (msg.type === 'reload_clients') {
      if (msg.serverBootId) {
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('sismosmex_server_boot_id', msg.serverBootId);
          }
        } catch (_) {}
      }
      this.forceClientReload(msg.reason || 'servidor_actualizado');
      return;
    }

    // 0.1 Sincronización automática de versión del servidor: si el serverBootId cambió, refrescar cliente
    if (msg.serverBootId) {
      this.handleServerUpdate(msg.serverBootId, msg.type || 'sincronizacion_ws');
    }

    if (msg.type === 'server_heartbeat') {
      return;
    }

    if (msg.type === 'initial_state') {
      if (Array.isArray(msg.stations)) {
        for (const st of msg.stations) {
          this.stations.set(st.code, st);
        }
        this.engine.syncLiveStations(msg.stations);
      }
      if (Array.isArray(msg.servers)) {
        this.servers = msg.servers;
      }
      if (Array.isArray(msg.events)) {
        this.earthquakes = msg.events.length > 0 ? msg.events : [...INITIAL_EARTHQUAKES];
        this.renderEarthquakeHistory();

        // Regla: al reiniciar el servidor o reconectar, reiniciar los eventos activos (no cargarlos en propagación activa)
        this.engine.clearActiveEvent();
        const latest = msg.events[0];
        if (latest) {
          this.engine.setLastSavedEvent(latest);
        }
      }
      this.renderSummaryCounters();
      this.renderStationsTable();
      this.renderServersTable();
    } else if (msg.type === 'sismosmp_signal') {
      this.showSismosMpNotification(msg);
    } else if (msg.type === 'narrator_speak') {
      if (this.engine?.audioManager?.narrator && msg.text) {
        this.engine.audioManager.narratePhrase(msg.text, { urgent: Boolean(msg.urgent) });
      }
    } else if (msg.type === 'trigger_alerta_sismica') {
      if (typeof window.alertaSismica === 'function') {
        window.alertaSismica(msg.duracion, msg.tipo, msg.nivel, msg.estados);
      }
    } else if (msg.type === 'stop_alerta_sismica') {
      if (typeof window.detenerAlerta === 'function') {
        window.detenerAlerta(true);
      }
    } else if (msg.type === 'earthquake_detected') {
      if (msg.event) {
        this.handleEarthquakeDetected(msg.event);
      }
    } else if (msg.type === 'earthquake_cancelled') {
      this.handleEarthquakeCancelled(msg);
    } else if (msg.type === 'earthquake_history_cleared') {
      this.earthquakes = [];
      this.renderEarthquakeHistory();
    } else if (msg.type === 'station_batch_update') {
      if (Array.isArray(msg.stations)) {
        for (const st of msg.stations) {
          this.stations.set(st.code, st);
        }
        this.engine.syncLiveStations(msg.stations);
        this.renderSummaryCounters();
        if (this.activeTab === 'stations') {
          this.updateAllStationRowsLive();
        }
      }
    } else if (msg.type === 'seedlink_server_status') {
      if (Array.isArray(msg.servers)) {
        this.servers = msg.servers;
        this.renderSummaryCounters();
        if (this.activeTab === 'servers') {
          this.renderServersTable();
        }
      }
    } else if (msg.type === 'seismic_data') {
      const stationCode = msg.station ? (msg.station.includes('.') ? msg.station.split('.').pop().trim().toUpperCase() : msg.station.trim().toUpperCase()) : '';

      // Actualizar estación en memoria
      let st = this.stations.get(stationCode) || this.stations.get(msg.station);
      if (st) {
        st.acceleration = msg.acceleration !== undefined ? msg.acceleration : (msg.pga || st.acceleration);
        st.accelerationStr = msg.pgaStr || `${(st.acceleration || 0).toFixed(3)} gal`;
        st.amp = msg.amp !== undefined ? msg.amp : st.amp;
        st.ampStr = msg.ampStr || `${(st.amp || 0).toFixed(1)} µm/s`;
        st.status = msg.status || (msg.staLta?.triggered ? 'Disparo STA/LTA' : 'Recibiendo');
        st.delay = msg.delay || '0.5s';
        st.delaySec = msg.delaySec || 0.5;
        st.pga = msg.pga !== undefined ? msg.pga : (st.acceleration || 0);
        st.pgaStr = msg.pgaStr || `${st.pga.toFixed(3)} gal`;
        st.intensity = msg.intensity !== undefined ? msg.intensity : (st.intensity || 0);
        st.staLtaRatio = msg.staLta ? msg.staLta.ratio : (st.staLtaRatio || 1.0);
        st.triggered = msg.staLta ? msg.staLta.triggered : false;
        st.lastPacketTime = msg.endTime || new Date().toISOString();
        st.packetCount = (st.packetCount || 0) + 1;
        if (msg.serverSource) st.serverSource = msg.serverSource;
      } else {
        st = {
          code: stationCode,
          network: msg.network || 'AM',
          fullCode: `${msg.network || 'AM'}.${stationCode}`,
          site: stationCode,
          state: '',
          lat: 19.4,
          lon: -99.1,
          primaryChannel: msg.channel || 'EHZ',
          acceleration: msg.acceleration || msg.pga || 0,
          accelerationStr: msg.pgaStr || `${(msg.acceleration || msg.pga || 0).toFixed(3)} gal`,
          amp: msg.amp || 0,
          ampStr: msg.ampStr || `${(msg.amp || 0).toFixed(1)} µm/s`,
          status: msg.status || 'Recibiendo',
          delay: msg.delay || '0.5s',
          delaySec: msg.delaySec || 0.5,
          pga: msg.pga || 0,
          pgaStr: msg.pgaStr || `${(msg.pga || 0).toFixed(3)} gal`,
          intensity: msg.intensity || 0,
          staLtaRatio: msg.staLta ? msg.staLta.ratio : 1.0,
          triggered: msg.staLta ? msg.staLta.triggered : false,
          lastPacketTime: msg.endTime || new Date().toISOString(),
          packetCount: 1,
          serverSource: msg.serverSource || 'SeedLink',
        };
        this.stations.set(stationCode, st);
        if (this.activeTab === 'stations') {
          const rowExists = document.getElementById(`row-station-${stationCode}`);
          if (!rowExists) {
            this.renderStationsTable();
          }
        }
      }

      // Actualizar en el motor de mapa
      this.engine.updateStationFromSeedLink(msg);

      // 1. Detección Inicial (Triggers de Ondas P / Estaciones Locales - Plantilla 1)
      // Si la estación registra un disparo genuino con PGA notable y no hay un evento finalizado
      if (st.triggered && (st.pga || 0) >= 0.70 && !st.code.startsWith('AM.')) {
        const now = Date.now();
        const lastAnnounced = this.announcedTriggerStations.get(st.code) || 0;
        if (now - lastAnnounced > 35000 && !this.engine.state.activeEvent) {
          this.announcedTriggerStations.set(st.code, now);
          if (this.engine.audioManager) {
            this.engine.audioManager.narrateTrigger(st);
          }
        }
      }

      // Si la fila de la estación está visible en pantalla, actualizarla puntualmente
      this.updateSingleStationRow(stationCode || msg.station);

      // Si es la estación abierta en el visor Swarm, agregar puntos
      const activeCode = this.activeStation ? (this.activeStation.code || '').trim().toUpperCase() : '';
      if (activeCode && (activeCode === stationCode || activeCode === (msg.station || '').trim().toUpperCase())) {
        this.appendLiveWaveformPoints(msg);
        this.updateSwarmMetrics(msg);
      }
    } else if (msg.type === 'station_waveform') {
      const target = msg.station ? (msg.station.includes('.') ? msg.station.split('.').pop().trim().toUpperCase() : msg.station.trim().toUpperCase()) : '';
      const activeCode = this.activeStation ? (this.activeStation.code || '').trim().toUpperCase() : '';
      if (activeCode && (activeCode === target || activeCode === (msg.station || '').trim().toUpperCase())) {
        if (Array.isArray(msg.waveform) && msg.waveform.length > 0) {
          this.mergeWaveformBuffer(msg.waveform);
        }
      }
    }
  }

  renderSummaryCounters() {
    const totalStEl = document.getElementById('statTotalStations');
    const onlineStEl = document.getElementById('statOnlineStations');
    const connectedServersEl = document.getElementById('statConnectedServers');
    const maxPgaEl = document.getElementById('statMaxPga');

    const total = this.stations.size;
    let online = 0;
    let maxPga = 0;

    this.stations.forEach((st) => {
      if (st.status === 'Recibiendo' || st.status === 'En línea' || st.status === 'Disparo STA/LTA') {
        online++;
      }
      if (st.pga > maxPga) maxPga = st.pga;
    });

    const connectedServers = this.servers.filter((s) => s.status === 'Done').length;
    const totalServers = this.servers.length || 25;

    if (totalStEl) totalStEl.innerText = total.toLocaleString();
    if (onlineStEl) onlineStEl.innerText = online.toLocaleString();
    if (connectedServersEl) connectedServersEl.innerText = `${connectedServers} / ${totalServers}`;
    if (maxPgaEl) maxPgaEl.innerText = `${maxPga.toFixed(3)} gal`;
  }

  getChannelBadgeHtml(channelCode) {
    const raw = (channelCode || 'BHZ').toUpperCase().trim();
    const prefix = raw.slice(0, 2);
    const last = raw.slice(-1);
    
    let typeClass = 'chan-badge-bb';
    let typeTitle = t('seedlink.typeBroadband');
    let label = raw;

    if (prefix === 'HN' || prefix === 'EN' || prefix === 'BN' || raw.includes('ACC')) {
      typeClass = 'chan-badge-accel';
      typeTitle = t('seedlink.typeStrong');
    } else if (prefix === 'EH' || prefix === 'SH') {
      typeClass = 'chan-badge-sp';
      typeTitle = t('seedlink.typeShort');
    }

    const isZ = last === 'Z';
    const orientText = isZ ? t('seedlink.orientVertical') : last;
    return `
      <span class="chan-badge ${typeClass}" title="${t('seedlink.chanTitle', { label, type: typeTitle, orient: orientText })}">
        ${isZ ? '<span class="chan-dot-z"></span>' : ''}
        ${label}
      </span>
    `;
  }

  renderStationsTable() {
    const tbody = document.getElementById('seedlinkStationsTableBody');
    if (!tbody) return;

    const list = Array.from(this.stations.values());
    const query = this.stationSearchQuery;
    const filter = this.stationFilterMode;

    const filtered = list.filter((st) => {
      // Búsqueda por texto
      if (query) {
        const full = `${st.code} ${st.network} ${st.primaryChannel || ''} ${st.site || ''} ${st.state || ''}`.toLowerCase();
        if (!full.includes(query)) return false;
      }
      // Filtros rápidos
      if (filter === 'online') {
        return st.status === 'Recibiendo' || st.status === 'En línea' || st.status === 'Disparo STA/LTA';
      }
      if (filter === 'trigger') {
        return st.triggered || st.status === 'Disparo STA/LTA';
      }
      if (filter === 'ig') {
        return st.network === 'IG';
      }
      if (filter === 'am') {
        return st.network === 'AM' || st.code.startsWith('R');
      }
      if (filter === 'gi') {
        return st.network === 'GI' || (st.state && st.state.toLowerCase().includes('guatemala')) || (st.networkName && st.networkName.toLowerCase().includes('guatemala'));
      }
      if (filter === 'sv') {
        return st.network === 'SV' || (st.state && st.state.toLowerCase().includes('salvador')) || (st.networkName && st.networkName.toLowerCase().includes('salvador'));
      }
      if (filter === 'hn') {
        return st.network === 'HN' || (st.state && st.state.toLowerCase().includes('honduras')) || (st.networkName && st.networkName.toLowerCase().includes('honduras'));
      }
      return true;
    });

    // Ordenar: primero los disparados/alertas, luego estaciones con datos recibidos, luego mayor aceleración
    filtered.sort((a, b) => {
      if (a.triggered && !b.triggered) return -1;
      if (!a.triggered && b.triggered) return 1;
      const aData = (a.packetCount > 0 && a.status !== 'Sin datos') ? 1 : 0;
      const bData = (b.packetCount > 0 && b.status !== 'Sin datos') ? 1 : 0;
      if (aData !== bData) return bData - aData;
      return (b.acceleration || 0) - (a.acceleration || 0);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="table-empty-row">
            No se encontraron estaciones para el criterio seleccionado
          </td>
        </tr>`;
      return;
    }

    // Renderizar todas las estaciones de la red para permitir desplazamiento vertical completo
    let html = '';

    for (const st of filtered) {
      const hasData = (st.packetCount > 0) && (st.status !== 'Sin datos');
      const isOnline = st.status === 'Recibiendo' || st.status === 'En línea' || st.status === 'Disparo STA/LTA';
      const statusClass = st.triggered
        ? 'status-badge-trigger'
        : isOnline
        ? 'status-badge-online'
        : (st.status === 'Reposo')
        ? 'status-badge-idle'
        : 'status-badge-nodata';

      const channelHtml = this.getChannelBadgeHtml(st.primaryChannel || 'BHZ');
      const accel = hasData ? (st.acceleration || 0) : 0;
      const accelStr = hasData ? (st.accelerationStr || `${accel.toFixed(3)} gal`) : '—';
      const ampStr = hasData ? (st.ampStr || `${(st.amp || 0).toFixed(1)} µm/s`) : '—';
      const pgaStr = hasData ? (st.pgaStr || `${(st.pga || accel).toFixed(3)} gal`) : '—';
      const delayStr = hasData ? (st.delay || '—') : '—';

      // Ancho visual de la barra de aceleración (0 a 5 gal mapeado a 0-100%)
      const barWidth = hasData ? Math.min(100, Math.max(3, (accel / 2.0) * 100)) : 0;
      const barColor = accel > 5.0 ? '#dc2626' : accel > 1.0 ? '#f97316' : accel > 0.1 ? '#eab308' : '#38bdf8';

      html += `
        <tr class="station-row ${st.triggered ? 'row-triggered' : ''}" id="row-station-${st.code}" data-code="${st.code}">
          <td>
            <div class="station-identity-cell">
              <span class="station-network-tag ${st.network === 'AM' ? 'tag-am' : st.network === 'GI' ? 'tag-gi' : st.network === 'HN' ? 'tag-hn' : 'tag-ig'}">${st.network || 'IG'}</span>
              <div class="station-names">
                <span class="station-code-txt">${st.code}</span>
                <span class="station-site-txt">${st.site || st.code}</span>
              </div>
            </div>
          </td>
          <td>
            <div id="row-chan-${st.code}">${channelHtml}</div>
          </td>
          <td>
            <div class="metric-cell-group">
              <span class="metric-value-num" id="row-accel-${st.code}">${accelStr}</span>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" id="row-bar-${st.code}" style="width: ${barWidth}%; background: ${barColor};"></div>
              </div>
            </div>
          </td>
          <td>
            <span class="amp-value-txt" id="row-amp-${st.code}">${ampStr}</span>
          </td>
          <td>
            <span class="status-pill-badge ${statusClass}" id="row-status-${st.code}">
              <span class="status-dot"></span>
              ${stationStatusLabel(st.status)}
            </span>
          </td>
          <td>
            <span class="delay-pill-txt" id="row-delay-${st.code}">${delayStr}</span>
          </td>
          <td>
            <div class="pga-cell-group">
              <span class="pga-num-txt" id="row-pga-${st.code}">${pgaStr}</span>
              ${hasData && st.intensity > 0 ? `<span class="mmi-tag">${getIntensityScale() === 'shindo' ? 'Shindo' : 'MMI'} ${formatIntensity(st.intensity)}</span>` : ''}
            </div>
          </td>
          <td style="text-align: right;">
            <button class="btn-action-swarm" data-station="${st.code}" title="${t('seedlink.viewSwarm')}">
              <span>〰️ Swarm</span>
            </button>
          </td>
        </tr>`;
    }

    tbody.innerHTML = html;

    // Asignar eventos de clic a las filas para abrir oscilograma
    tbody.querySelectorAll('.btn-action-swarm').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.getAttribute('data-station');
        const st = this.stations.get(code);
        if (st) this.openSwarmViewer(st);
      });
    });

    tbody.querySelectorAll('.station-row').forEach((row) => {
      row.addEventListener('click', () => {
        const code = row.getAttribute('data-code');
        const st = this.stations.get(code);
        if (st) this.openSwarmViewer(st);
      });
    });
  }

  updateSingleStationRow(code) {
    const st = this.stations.get(code);
    if (!st) return;

    const elChan = document.getElementById(`row-chan-${code}`);
    const elAccel = document.getElementById(`row-accel-${code}`);
    const elBar = document.getElementById(`row-bar-${code}`);
    const elAmp = document.getElementById(`row-amp-${code}`);
    const elStatus = document.getElementById(`row-status-${code}`);
    const elDelay = document.getElementById(`row-delay-${code}`);
    const elPga = document.getElementById(`row-pga-${code}`);

    const hasData = (st.packetCount > 0) && (st.status !== 'Sin datos');
    const accel = hasData ? (st.acceleration || 0) : 0;
    const accelStr = hasData ? (st.accelerationStr || `${accel.toFixed(3)} gal`) : '—';
    const ampStr = hasData ? (st.ampStr || `${(st.amp || 0).toFixed(1)} µm/s`) : '—';
    const pgaStr = hasData ? (st.pgaStr || `${(st.pga || accel).toFixed(3)} gal`) : '—';
    const delayStr = hasData ? (st.delay || '—') : '—';

    if (elChan && st.primaryChannel) {
      elChan.innerHTML = this.getChannelBadgeHtml(st.primaryChannel);
    }
    if (elAccel) elAccel.innerText = accelStr;
    if (elBar) {
      const barWidth = hasData ? Math.min(100, Math.max(3, (accel / 2.0) * 100)) : 0;
      const barColor = accel > 5.0 ? '#dc2626' : accel > 1.0 ? '#f97316' : accel > 0.1 ? '#eab308' : '#38bdf8';
      elBar.style.width = `${barWidth}%`;
      elBar.style.background = barColor;
    }
    if (elAmp) elAmp.innerText = ampStr;
    if (elStatus) {
      const isOnline = st.status === 'Recibiendo' || st.status === 'En línea' || st.status === 'Disparo STA/LTA';
      const statusClass = st.triggered
        ? 'status-badge-trigger'
        : isOnline
        ? 'status-badge-online'
        : (st.status === 'Reposo')
        ? 'status-badge-idle'
        : 'status-badge-nodata';
      elStatus.className = `status-pill-badge ${statusClass}`;
      elStatus.innerHTML = `<span class="status-dot"></span> ${stationStatusLabel(st.status)}`;
    }
    if (elDelay) elDelay.innerText = delayStr;
    if (elPga) elPga.innerText = pgaStr;
  }

  updateStationTableDelays() {
    const now = Date.now();
    this.stations.forEach((st) => {
      const lastMs = st.lastPacketTime ? new Date(st.lastPacketTime).getTime() : 0;
      const diffSec = Math.round((now - lastMs) / 1000);
      st.delay = diffSec > 120 ? `${Math.round(diffSec / 60)}m` : `${diffSec}s`;
      const elDelay = document.getElementById(`row-delay-${st.code}`);
      if (elDelay) elDelay.innerText = st.delay;
    });
  }

  renderServersTable() {
    const tbody = document.getElementById('seedlinkServersTableBody');
    if (!tbody) return;

    if (this.servers.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty-row">
            ${t('seedlink.poolConnecting')}
          </td>
        </tr>`;
      return;
    }

    // Ordenar servidores: primero el servidor troncal primario SSN Nunca Muere
    const sortedServers = [...this.servers].sort((a, b) => {
      const aPrio = a.id === 'ssn' || a.isPrimary ? 1 : 2;
      const bPrio = b.id === 'ssn' || b.isPrimary ? 1 : 2;
      return aPrio - bPrio;
    });

    let html = '';
    for (const s of sortedServers) {
      const isPrimary = s.id === 'ssn' || s.isPrimary;
      const isDone = s.status === 'Done';
      const isTimeout = s.status && s.status.includes('timed out');

      const statusClass = isDone
        ? 'server-status-done'
        : isTimeout
        ? 'server-status-timeout'
        : 'server-status-error';

      const statusText = serverStatusLabel(s.status);

      html += `
        <tr class="server-table-row ${isPrimary ? 'server-row-primary' : ''}">
          <td style="font-weight: 700; color: #ffffff;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${isPrimary ? `<span class="primary-server-badge" title="${t('seedlink.primaryServer')}">${t('seedlink.trunkBadge')}</span>` : ''}
              <span>${s.name}</span>
            </div>
          </td>
          <td style="font-family: monospace; color: #38bdf8; font-weight: 600; font-size: 11px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 2px 6px;">
              ${t('seedlink.privateLink')}
            </span>
          </td>
          <td style="font-family: monospace; color: #cbd5e1;">${s.port || 18000}</td>
          <td style="font-family: monospace; color: #eab308; font-weight: 700;">${s.timeoutSec || 20}s</td>
          <td>
            <span class="server-status-pill ${statusClass}" id="srv-status-${s.id}">
              ${statusText}
            </span>
          </td>
          <td style="font-family: monospace; font-size: 11px; color: ${isPrimary ? '#38bdf8' : '#94a3b8'};" id="srv-telem-${s.id}">
            ${(s.packetsReceived || 0).toLocaleString()} pkts • ${s.bitrateKbps || 0} kbps
          </td>
        </tr>`;
    }

    tbody.innerHTML = html;
  }

  filterLocal1To10Hz(pts, sampleRate) {
    if (!pts || pts.length === 0) return [];
    const fs = sampleRate > 0 ? sampleRate : 20;
    const dt = 1.0 / fs;
    const n = pts.length;

    // Etapa 1: Filtro Paso-Altos a 1.0 Hz (Elimina offset instrumental y deriva de largo periodo)
    const tauHp = 1.0 / (2 * Math.PI * 1.0);
    const alphaHp = tauHp / (tauHp + dt);
    const hp = new Float32Array(n);

    let prevX = pts[0].accelGal || 0;
    let prevY = 0;
    hp[0] = 0;

    for (let i = 1; i < n; i++) {
      const x = pts[i].accelGal || 0;
      prevY = alphaHp * (prevY + x - prevX);
      hp[i] = prevY;
      prevX = x;
    }

    // Etapa 2: Filtro Paso-Bajos a 10.0 Hz (o frecuencia segura debajo de Nyquist)
    const fCutLp = Math.min(10.0, fs * 0.46);
    const tauLp = 1.0 / (2 * Math.PI * fCutLp);
    const alphaLp = dt / (tauLp + dt);
    const out = new Float32Array(n);

    let yLp = hp[0];
    out[0] = yLp;

    for (let i = 1; i < n; i++) {
      yLp = yLp + alphaLp * (hp[i] - yLp);
      out[i] = yLp;
    }

    return out;
  }

  renderSwarmDelay(delayStr, delaySec) {
    const delayEl = document.getElementById('swarmMetricDelay');
    const bottomDelayEl = document.getElementById('swarmBottomDelay');
    const subDelayEl = document.getElementById('swarmSubDelay');

    const elements = [delayEl, bottomDelayEl, subDelayEl].filter(Boolean);
    if (elements.length === 0) return;

    if (!delayStr || delayStr === '—' || delayStr === 'Sin datos') {
      elements.forEach((el) => {
        el.innerText = '—';
        el.className = 'swarm-metric-val swarm-delay-badge';
      });
      return;
    }

    const sec = typeof delaySec === 'number' ? delaySec : parseFloat(delayStr);
    let colorClass = '';
    if (!isNaN(sec)) {
      if (sec <= 2.5) {
        colorClass = 'delay-good';
      } else if (sec <= 15) {
        colorClass = 'delay-warn';
      } else {
        colorClass = 'delay-bad';
      }
    } else {
      if (delayStr.endsWith('m') || delayStr.includes('min')) {
        colorClass = 'delay-bad';
      } else {
        colorClass = 'delay-warn';
      }
    }

    elements.forEach((el) => {
      el.innerText = delayStr;
      el.className = `swarm-metric-val swarm-delay-badge ${colorClass}`.trim();
    });
  }

  updateActiveStationDelay() {
    if (!this.activeStation) return;
    const st = this.activeStation;
    let delayStr = st.delay || '—';
    let delaySec = st.delaySec || 0;

    if (st.lastPacketTime) {
      const lastMs = new Date(st.lastPacketTime).getTime();
      const now = Date.now();
      const diffSec = Math.max(0.1, Number(((now - lastMs) / 1000).toFixed(1)));
      delaySec = diffSec;
      delayStr = diffSec > 120 ? `${Math.round(diffSec / 60)}m` : `${diffSec.toFixed(1)}s`;
      st.delay = delayStr;
      st.delaySec = delaySec;
    }

    this.renderSwarmDelay(delayStr, delaySec);
  }

  openSwarmViewer(station) {
    // El oscilograma (swarm) está desactivado en la vista móvil
    if (SWARM_MOBILE_QUERY.matches) return;
    const isSameStation = this.activeStation && (this.activeStation.code === station.code);
    this.activeStation = station;
    if (!isSameStation) {
      this.waveformBuffer = [];
      this.smoothMaxA = undefined;
    }
    if (this.swarmPanelEl) this.swarmPanelEl.classList.add('open');

    const clean = station.code.includes('.') ? station.code.split('.').pop().trim() : station.code.trim();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_active_station', station: clean }));
    }

    const isAm = (station.network === 'AM') || (station.code && station.code.startsWith('R'));
    const netPrefix = station.network || (isAm ? 'AM' : 'IG');
    const chan = (station.primaryChannel || (isAm ? 'EHZ' : 'BHZ')).toUpperCase();
    const chanType = (chan.startsWith('HN') || chan.startsWith('EN'))
      ? t('seedlink.chanAccel')
      : (chan.startsWith('EH') || chan.startsWith('SH') || isAm)
      ? t('seedlink.chanShort')
      : t('seedlink.chanBroadband');
    const isZ = chan.endsWith('Z');

    const codeEl = document.getElementById('swarmStationCode');
    const subEl = document.getElementById('swarmStationSub');
    if (codeEl) {
      codeEl.innerText = `${netPrefix}.${station.code} — ${station.site || station.name || station.code}`;
    }
    if (subEl) {
      const serverTxt = station.serverSource && station.serverSource !== '—'
        ? `${t('seedlink.serverPrefix')}${station.serverSource}`
        : (isAm ? `${t('seedlink.serverPrefix')}${t('seedlink.amNode')}` : '');
      const stateTxt = station.state ? ` (${station.state})` : '';
      const sampleRate = station.sampleRate || (isAm ? 100 : 20);
      subEl.innerHTML = `
        <span class="swarm-channel-pill"><span class="chan-dot-z"></span> ${t('seedlink.activeChannel', { chan, type: chanType, dir: isZ ? t('seedlink.vertical') : t('seedlink.horizontal') })}</span>
        <span>• ${sampleRate} sps • Lat: ${Number(station.lat).toFixed(3)}° • Lon: ${Number(station.lon).toFixed(3)}°${stateTxt}${serverTxt}</span>
        <span style="display:inline-flex; align-items:center; gap:4px; margin-left:4px;">• ${t('seedlink.latency')} <span class="swarm-delay-badge" id="swarmSubDelay">—</span></span>
      `;
    }

    const netMetricEl = document.getElementById('swarmMetricNet');
    if (netMetricEl) {
      netMetricEl.innerText = isAm ? 'AM (Raspberry Shake)' : (netPrefix || 'IG');
      netMetricEl.style.color = isAm ? '#a78bfa' : '#38bdf8';
    }

    // Calcular y renderizar Delay en tiempo real en la barra de Swarm
    this.updateActiveStationDelay();

    const hasData = (station.packetCount > 0) && (station.status !== 'Sin datos');
    const pgaEl = document.getElementById('swarmMetricPga');
    const intEl = document.getElementById('swarmMetricInt');
    const ratioEl = document.getElementById('swarmMetricRatio');
    if (pgaEl) pgaEl.innerText = hasData ? (station.pgaStr || `${(station.pga || 0).toFixed(3)} gal`) : '—';
    if (intEl) intEl.innerText = hasData ? (station.intensity > 0 ? formatIntensity(station.intensity) : '0') : '—';
    if (ratioEl) {
      ratioEl.innerText = hasData && station.staLtaRatio ? station.staLtaRatio.toFixed(2) : '—';
      ratioEl.style.color = '#e2e8f0';
    }

    // Pedir buffer existente de la estación
    this.fetchStationWaveform(station.code);
  }

  closeSwarmViewer() {
    this.activeStation = null;
    this.engine.selectedStation = null;
    if (this.swarmPanelEl) this.swarmPanelEl.classList.remove('open');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'clear_active_station' }));
    }
  }

  appendLiveWaveformPoints(msg) {
    // 1. Obtener muestras: preferir muestras de aceleración física procesadas por el servidor (en gal)
    const accelSamples = msg.accelSamples;
    const rawSamples = msg.rawSamples || msg.samplesPreview;
    
    const count = (accelSamples && accelSamples.length > 0)
      ? accelSamples.length
      : (rawSamples ? rawSamples.length : 0);

    if (count === 0) return;

    const sampleRate = msg.sampleRate || 20;
    const dt = 1000 / sampleRate;
    const startMs = new Date(msg.startTime || '').getTime() ||
      (new Date(msg.endTime || Date.now()).getTime() - ((count - 1) * dt));

    if (!this.waveformBuffer) this.waveformBuffer = [];

    // Timestamp del último punto existente para evitar insertar puntos duplicados
    const lastExistingMs = this.waveformBuffer.length > 0
      ? new Date(this.waveformBuffer[this.waveformBuffer.length - 1].time).getTime()
      : 0;

    // Si no tenemos muestras procesadas en gal, centramos las muestras crudas restando la media
    let demeanedRaw = [];
    let scaleToGal = 1;
    if (!accelSamples || accelSamples.length === 0) {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += rawSamples[i];
      const mean = count > 0 ? sum / count : 0;
      let maxDev = 1;
      for (let i = 0; i < count; i++) {
        const d = rawSamples[i] - mean;
        demeanedRaw.push(d);
        if (Math.abs(d) > maxDev) maxDev = Math.abs(d);
      }
      const peakGal = msg.acceleration || msg.pga || 0.005;
      scaleToGal = peakGal / maxDev;
    }

    // Agregar puntos con continuidad temporal
    for (let i = 0; i < count; i++) {
      const ptMs = startMs + i * dt;
      // Agregar solo puntos estrictamente posteriores o si hay un salto temporal (> 10s)
      if (ptMs > lastExistingMs || (lastExistingMs > 0 && Math.abs(ptMs - lastExistingMs) > 10000)) {
        const ptTime = new Date(ptMs).toISOString();
        const raw = rawSamples ? rawSamples[i] : 0;
        const accel = accelSamples
          ? Number(accelSamples[i].toFixed(4))
          : Number((demeanedRaw[i] * scaleToGal).toFixed(4));

        this.waveformBuffer.push({
          time: ptTime,
          count: raw,
          accelGal: accel,
        });
      }
    }

    // Mantener ventana continua y deslizante (últimos 1500 puntos = ~75s a 20 sps)
    const maxWindow = 1500;
    if (this.waveformBuffer.length > maxWindow) {
      this.waveformBuffer.splice(0, this.waveformBuffer.length - maxWindow);
    }
  }

  updateSwarmMetrics(msg) {
    const pgaEl = document.getElementById('swarmMetricPga');
    const intEl = document.getElementById('swarmMetricInt');
    const ratioEl = document.getElementById('swarmMetricRatio');

    if (msg.channel && this.activeStation) {
      this.activeStation.primaryChannel = msg.channel;
    }

    // Actualizar delay en vivo de la estación activa
    if (this.activeStation && (msg.station === this.activeStation.code || msg.station === this.activeStation.fullCode)) {
      if (msg.delay !== undefined || msg.delaySec !== undefined) {
        this.activeStation.delay = msg.delay || `${(msg.delaySec || 0).toFixed(1)}s`;
        this.activeStation.delaySec = msg.delaySec;
        this.activeStation.lastPacketTime = msg.endTime || new Date().toISOString();
        this.renderSwarmDelay(this.activeStation.delay, this.activeStation.delaySec);
      } else {
        this.updateActiveStationDelay();
      }
    }

    if (pgaEl) pgaEl.innerText = msg.pgaStr || `${(msg.pga || msg.acceleration || 0).toFixed(3)} gal`;
    if (intEl) intEl.innerText = msg.intensity > 0 ? formatIntensity(msg.intensity) : '0';
    if (ratioEl && msg.staLta) {
      ratioEl.innerText = `${msg.staLta.ratio.toFixed(2)} ${msg.staLta.triggered ? '⚡ DISPARO' : ''}`;
      ratioEl.style.color = msg.staLta.triggered ? '#ef4444' : '#e2e8f0';
    }
  }

  startSwarmRenderLoop() {
    let lastDelayTick = 0;
    const render = () => {
      if (this.activeStation && this.swarmPanelEl && this.swarmPanelEl.classList.contains('open')) {
        const now = Date.now();
        if (now - lastDelayTick > 800) {
          lastDelayTick = now;
          this.updateActiveStationDelay();
        }
        this.renderWaveformCanvas();
        this.renderStaLtaCanvas();
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  renderWaveformCanvas() {
    if (!this.waveCanvas || !this.waveCtx) return;
    const ctx = this.waveCtx;
    const parent = this.waveCanvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth || 600;
    const h = parent.clientHeight || 200;

    if (this.waveCanvas.width !== w || this.waveCanvas.height !== h) {
      this.waveCanvas.width = w;
      this.waveCanvas.height = h;
    }

    ctx.fillStyle = '#080d14';
    ctx.fillRect(0, 0, w, h);

    // Cuadrícula sismográfica sutil
    ctx.strokeStyle = '#111e2e';
    ctx.lineWidth = 1;
    const gridCols = 8;
    for (let c = 1; c < gridCols; c++) {
      const gx = (w / gridCols) * c;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }

    // Eje central de reposo (línea base)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const pts = this.waveformBuffer;
    if (!pts || pts.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const st = this.activeStation;
      const code = st ? `${st.network || 'AM'}.${st.code}` : '';
      const site = st ? (st.site || st.name || '') : '';
      const srv = st && st.serverSource && st.serverSource !== '—' ? t('seedlink.fromServer', { server: st.serverSource }) : '';
      ctx.fillText(t('seedlink.waitingLive', { code, site: site ? ` (${site})` : '', server: srv }), w / 2, h / 2);
      return;
    }

    // Filtro sismológico local (1 - 10 Hz) para ondas P/S y atenuación de derivas/ruido
    const sampleRate = (this.activeStation && this.activeStation.sampleRate) || 20;
    const filteredA = this.filterLocal1To10Hz(pts, sampleRate);

    // Cálculo y amortiguación de ganancia vertical (Damping / Auto-Gain Smoothing)
    // Previene que un pico comprima o deforme bruscamente la línea al entrar nueva información
    let targetMaxA = 0.005;
    for (let i = 0; i < filteredA.length; i++) {
      const v = Math.abs(filteredA[i]);
      if (v > targetMaxA) targetMaxA = v;
    }

    if (this.smoothMaxA === undefined || isNaN(this.smoothMaxA)) {
      this.smoothMaxA = targetMaxA;
    } else {
      if (targetMaxA > this.smoothMaxA) {
        // Adaptación rápida en subida para no recortar la cresta de la onda
        this.smoothMaxA = this.smoothMaxA * 0.88 + targetMaxA * 0.12;
      } else {
        // Decaimiento muy suave y progresivo en reposo
        this.smoothMaxA = this.smoothMaxA * 0.985 + targetMaxA * 0.015;
      }
    }

    const currentScale = Math.max(0.003, this.smoothMaxA);
    const scaleY = (h * 0.40) / currentScale;

    // Trazado de la onda sismográfica con Filtro Local 1 - 10 Hz (Verde Esmeralda Sismológico)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const dx = w / (filteredA.length - 1);
    for (let i = 0; i < filteredA.length; i++) {
      const a = filteredA[i];
      const x = i * dx;
      const y = h / 2 - a * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Rótulos de escala con tipografía limpia y legible
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`+${currentScale.toFixed(3)} gal`, 8, 14);
    ctx.fillText(`-${currentScale.toFixed(3)} gal`, 8, h - 6);
    ctx.fillStyle = '#64748b';
    ctx.fillText(t('seedlink.baseline'), 8, h / 2 - 4);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(t('seedlink.liveFooter', { n: pts.length }), w - 10, 14);
  }

  renderStaLtaCanvas() {
    if (!this.staltaCanvas || !this.staltaCtx) return;
    const ctx = this.staltaCtx;
    const parent = this.staltaCanvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth || 600;
    const h = parent.clientHeight || 90;

    if (this.staltaCanvas.width !== w || this.staltaCanvas.height !== h) {
      this.staltaCanvas.width = w;
      this.staltaCanvas.height = h;
    }

    ctx.fillStyle = '#060a0f';
    ctx.fillRect(0, 0, w, h);

    const maxRatio = 6.0;
    const threshold = 3.5;
    const yThresh = h - (threshold / maxRatio) * h;

    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yThresh);
    ctx.lineTo(w, yThresh);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ef4444';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(t('seedlink.threshold'), 6, Math.max(12, yThresh - 4));

    const pts = this.waveformBuffer;
    if (!pts || pts.length < 2) return;

    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const dx = w / (pts.length - 1);
    let sta = 0.01;
    let lta = 0.01;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i].accelGal || 0;
      const energy = a * a;
      sta = 0.95 * sta + 0.05 * energy;
      lta = 0.995 * lta + 0.005 * energy;
      const ratio = sta / (lta + 1e-6);

      const x = i * dx;
      const clamped = Math.min(maxRatio, ratio);
      const y = h - (clamped / maxRatio) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // =========================================================================
  // GESTIÓN DEL HISTORIAL Y DETECCIÓN DE SISMOS (3 ETAPAS)
  // =========================================================================

  handleEarthquakeDetected(event, initialElapsedMs = 0) {
    if (!event) return;

    // Evitar duplicados por ID, displayId o coincidencia espacio-temporal
    const evTime = event.timeEpoch || (event.detectedAt ? new Date(event.detectedAt).getTime() : (event.time ? new Date(event.time).getTime() : Date.now()));
    const calculatedElapsedMs = Math.max(0, Date.now() - evTime);
    const elapsedMs = initialElapsedMs > 0 ? initialElapsedMs : calculatedElapsedMs;

    const existingIndex = this.earthquakes.findIndex((e) => {
      if (e.id === event.id) return true;
      if (e.displayId && event.displayId && e.displayId === event.displayId) return true;
      const eTime = e.timeEpoch || (e.time ? new Date(e.time).getTime() : 0);
      const timeDiff = Math.abs(eTime - evTime);
      if (timeDiff < 30000 && e.latitude && e.longitude && event.latitude && event.longitude) {
        const dLat = (event.latitude - e.latitude) * Math.PI / 180;
        const dLon = (event.longitude - e.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(e.latitude*Math.PI/180)*Math.cos(event.latitude*Math.PI/180)*Math.sin(dLon/2)**2;
        const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (distKm < 150) return true;
      }
      return false;
    });

    if (existingIndex >= 0) {
      const prev = this.earthquakes[existingIndex];
      this.earthquakes[existingIndex] = {
        ...prev,
        ...event,
        magnitude: Math.max(prev.magnitude || 0, event.magnitude || 0),
        maxPga: Math.max(prev.maxPga || 0, event.maxPga || 0),
        maxIntensity: Math.max(prev.maxIntensity || 1, event.maxIntensity || 1),
        stationCount: Math.max(prev.stationCount || 0, event.stationCount || 0),
        reportNumber: Math.max(prev.reportNumber || 1, event.reportNumber || 1),
      };
      this.renderEarthquakeHistory();

      // Si el evento ya está activo en el motor, actualizar su estimación dinámica en tiempo real
      if (this.engine && this.engine.state?.activeEvent) {
        this.engine.updateEventEstimation(event);
        if (event.status === 'CONFIRMED' || event.confirmed) {
          this.engine.confirmCurrentEvent(event);
        }
        this.engine.checkAndPlayModerateExceededMeow?.(event);
        return;
      }
    } else {
      this.earthquakes.unshift(event);
      if (this.earthquakes.length > 50) this.earthquakes.pop();
      this.renderEarthquakeHistory();
    }

    // Si el evento ya concluyó su propagación (> 300 segundos desde su origen):
    if (elapsedMs >= 300000) {
      if (this.engine.state?.activeEvent && this.engine.state.activeEvent.id === event.id) {
        this.engine.clearActiveEvent();
      }
      return;
    }

    const isConfirmed = event.status === 'CONFIRMED' || Boolean(event.confirmed);

    // Si el evento recibido es una confirmación de un evento post-propagación:
    if (isConfirmed && this.engine.state.activeEvent) {
      this.engine.confirmCurrentEvent(event);
      this.engine.checkAndPlayModerateExceededMeow?.(event);
      this.engine.focusOnCoordinates(event.latitude, event.longitude, 1.4);
      if (typeof window.switchSidebarTab === 'function') {
        window.switchSidebarTab('activity');
      }
      return;
    }

    // Activar en el motor de mapa con el desfase temporal real
    this.engine.triggerEvent(event, elapsedMs);
    this.engine.checkAndPlayModerateExceededMeow?.(event);
    this.engine.focusOnCoordinates(event.latitude, event.longitude, 1.4);

    // Garantizar que suene deteccion.mp3 de forma inmediata al detectar un sismo en vivo
    if (!this.playedDetections) this.playedDetections = new Set();
    if (!this.playedDetections.has(event.id)) {
      this.playedDetections.add(event.id);
      if (this.engine?.audioManager) {
        this.engine.audioManager.playDeteccion();
      }
    }

    // Conmutar rápidamente a la sección de Actividad si está en otra vista
    if (typeof window.switchSidebarTab === 'function') {
      window.switchSidebarTab('activity');
    }

    console.log(`[SeedLinkUI] Sismo desplegado: ID=${event.id}, Mag=${event.magnitude}, Loc=${event.location}, Status=${event.status || 'PRELIMINARY'}, Elapsed=${Math.round(elapsedMs/1000)}s`);
  }

  handleEarthquakeCancelled(msg) {
    const eventId = msg?.eventId || msg?.id;
    const displayId = msg?.displayId || '';
    const message = msg?.message || t('seedlink.cancelledDefault');

    console.log(`[SeedLinkUI] 🛑 SISMO CANCELADO: ID=${eventId} [${displayId}]. Reproduciendo desconfirmacion.mp3`);

    // 1. Descartar del motor de mapa y reproducir desconfirmacion.mp3
    if (this.engine) {
      this.engine.dismissActiveEvent(eventId);
    }

    // 2. Retirar de la lista histórica si coincidía
    if (eventId) {
      const clean = String(eventId).toUpperCase();
      this.earthquakes = this.earthquakes.filter((e) => {
        const fullId = (e.id || '').toUpperCase();
        const dId = (e.displayId || '').toUpperCase();
        return fullId !== clean && dId !== clean && !fullId.includes(clean);
      });
      this.renderEarthquakeHistory();
    }

    // 3. Notificación sutil en pantalla
    this.showCancellationNotification(message, displayId);
  }

  showCancellationNotification(message, displayId) {
    const existing = document.getElementById('sismoCancelToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sismoCancelToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(245, 158, 11, 0.45);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: #f1f5f9;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 99999;
      pointer-events: none;
      transition: opacity 0.3s ease;
    `;
    toast.innerHTML = `
      <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:rgba(245, 158, 11, 0.2); color:#fbbf24; font-weight:bold; font-size:12px;">✕</span>
      <div>
        <strong style="color: #fbbf24;">${t('seedlink.discarded')}</strong>
        ${displayId ? `<span style="font-size: 10px; font-family: monospace; color: #94a3b8; margin-left: 6px;">#${displayId}</span>` : ''}
        <div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">${message}</div>
      </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast && toast.parentNode) {
        toast.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 500);
      }
    }, 4500);
  }

  saveEventToHistory(savedEv) {
    if (!savedEv) return;
    const evTime = savedEv.timeEpoch || (savedEv.time ? new Date(savedEv.time).getTime() : Date.now());
    const existingIndex = this.earthquakes.findIndex((e) => {
      if (e.id === savedEv.id) return true;
      if (e.displayId && savedEv.displayId && e.displayId === savedEv.displayId) return true;
      const eTime = e.timeEpoch || (e.time ? new Date(e.time).getTime() : 0);
      const timeDiff = Math.abs(eTime - evTime);
      if (timeDiff < 90000 && e.latitude && e.longitude && savedEv.lat && savedEv.lon) {
        const dLat = (savedEv.lat - e.latitude) * Math.PI / 180;
        const dLon = (savedEv.lon - e.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(e.latitude*Math.PI/180)*Math.cos(savedEv.lat*Math.PI/180)*Math.sin(dLon/2)**2;
        const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (distKm < 280) return true;
      }
      return false;
    });

    if (existingIndex >= 0) {
      const prev = this.earthquakes[existingIndex];
      this.earthquakes[existingIndex] = {
        ...prev,
        ...savedEv,
        magnitude: Math.max(prev.magnitude || 0, savedEv.mag || savedEv.magnitude || 0),
        maxPga: Math.max(prev.maxPga || 0, savedEv.maxPga || 0),
        maxIntensity: Math.max(prev.maxIntensity || 1, savedEv.maxIntensity || 1),
        saved: true,
      };
    } else {
      this.earthquakes.unshift({ ...savedEv, saved: true });
      if (this.earthquakes.length > 50) this.earthquakes.pop();
    }
    this.renderEarthquakeHistory();
  }

  /**
   * Detecta si el identificador de arranque del servidor ha cambiado y recarga el sitio
   */
  handleServerUpdate(newBootId, reason = 'actualización') {
    if (!newBootId || this.isReloadingDueToUpdate) return;

    if (!this.currentServerBootId) {
      this.currentServerBootId = newBootId;
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('sismosmex_server_boot_id', newBootId);
        }
      } catch (_) {}
      return;
    }

    if (this.currentServerBootId !== newBootId) {
      this.isReloadingDueToUpdate = true;
      console.log(`[SeedLinkUI] 🔄 Servidor actualizado detectado (ID previo: ${this.currentServerBootId}, nuevo: ${newBootId}, vía: ${reason}). Refrescando sitio...`);
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('sismosmex_server_boot_id', newBootId);
        }
      } catch (_) {}

      this.showUpdateReloadNotification(t('seedlink.updatingSite'));
      setTimeout(() => {
        window.location.reload();
      }, 600);
    }
  }

  /**
   * Fuerza el refresco de este cliente por orden directa del servidor
   */
  forceClientReload(reason = 'servidor') {
    if (this.isReloadingDueToUpdate) return;
    this.isReloadingDueToUpdate = true;
    console.log(`[SeedLinkUI] 🔄 Orden de refresco recibida del servidor (${reason}). Actualizando sitio...`);
    this.showUpdateReloadNotification(t('seedlink.serverUpdated'));
    setTimeout(() => {
      window.location.reload();
    }, 600);
  }

  /**
   * Muestra un indicador visual discreto antes de refrescar
   */
  showUpdateReloadNotification(message) {
    try {
      let banner = document.getElementById('serverReloadNotificationBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'serverReloadNotificationBanner';
        banner.style.cssText = `
          position: fixed;
          top: 18px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9999999;
          background: #0284c7;
          color: #ffffff;
          padding: 10px 22px;
          border-radius: 8px;
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.6);
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          pointer-events: none;
        `;
        banner.innerHTML = `
          <svg style="width: 20px; height: 20px; animation: spin 1s linear infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>${message}</span>
        `;
        document.body.appendChild(banner);
      }
    } catch (_) {}
  }

  renderEarthquakeHistory() {
    // Sincronizar el panel principal en reposo si no hay sismo en curso
    try {
      const hasActive = Boolean(this.engine?.state?.activeEvent || this.engine?.activeEvent);
      if (!hasActive && this.engine) {
        const snap = typeof this.engine.getStateSnapshot === 'function'
          ? this.engine.getStateSnapshot()
          : (typeof this.engine.getSnapshot === 'function' ? this.engine.getSnapshot() : null);
        if (snap) {
          if (typeof this.engine.onStateChange === 'function') {
            this.engine.onStateChange(snap);
          } else if (typeof this.engine.options?.onStateChange === 'function') {
            this.engine.options.onStateChange(snap);
          }
        }
      }
    } catch (_) {}

    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    if (!this.earthquakes || this.earthquakes.length === 0) {
      listEl.innerHTML = `
        <div class="history-empty-state" id="historyEmpty">
          <span style="font-size: 20px; opacity: 0.6;">📡</span>
          <span>${t('sidebar.noEvents')}</span>
        </div>
      `;
      return;
    }

    // Orden cronológico descendente (más reciente primero); no muta this.earthquakes
    const eventEpoch = (e) => e.timeEpoch || Date.parse(e.time) || 0;
    const sortedEvents = [...this.earthquakes].sort((a, b) => eventEpoch(b) - eventEpoch(a));

    listEl.innerHTML = sortedEvents
      .map((ev) => {
        const intVal = Math.max(1, Math.min(10, Math.round(ev.maxIntensity || 1)));
        const roman = formatIntensity(intVal);
        const theme = getIntensityTheme(intVal);

        const d = ev.time ? new Date(ev.time) : new Date();
        const dateStr = d.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
        const timeStr = d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const isInter = Boolean(
          ev.isInter ||
          ev.category === 'inter' ||
          (ev.source && (ev.source.toLowerCase().includes('inter') || ev.source.toLowerCase().includes('usgs')))
        );

        const interBadge = isInter
          ? `<span class="history-inter-chip" style="background: rgba(56, 189, 248, 0.22); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.55); padding: 1px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><span style="font-size: 11px;">🌐</span> INTER</span>`
          : '';

        return `
          <div class="history-card-item ${isInter ? 'history-card-inter' : ''}" data-eq-id="${ev.id}">
            <div class="history-int-badge" style="background: ${theme.bg}; color: ${theme.text}; box-shadow: 0 0 8px ${theme.bg}55;">
              <span class="history-int-label" style="color: ${theme.text}; opacity: 0.85;">INT</span>
              <span class="history-int-number" style="color: ${theme.text};">${roman}</span>
            </div>
            <div class="history-details">
              <div class="history-loc-text" title="${ev.location}">${ev.location}</div>
              <div class="history-time-text">${dateStr} ${timeStr}</div>
              <div class="history-metrics-row">
                <span class="history-metric-chip">
                  <span class="chip-bar-yellow"></span>
                  M ${Number(ev.magnitude || ev.mag || 0).toFixed(1)}
                </span>
                <span class="history-metric-chip">
                  <span class="chip-bar-cyan"></span>
                  ${ev.depth} km
                </span>
                ${interBadge}
                ${ev.status === 'PRELIMINARY' ? '<span style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 700;">PRELIMINAR</span>' : ''}
                ${!isInter ? `<span style="color: #64748b; font-size: 10px; margin-left: auto;">${ev.stationCount || (ev.stations ? ev.stations.length : 1)} est</span>` : ''}
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Evento clic para centrar en el mapa y desplegar la información del sismo
    listEl.querySelectorAll('.history-card-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-eq-id');
        const ev = this.earthquakes.find((e) => e.id === id);
        if (ev) {
          const isInter = Boolean(
            ev.isInter ||
            ev.category === 'inter' ||
            (ev.source && (ev.source.toLowerCase().includes('inter') || ev.source.toLowerCase().includes('usgs')))
          );
          // Al seleccionar un sismo del historial, desplegarlo como sismo guardado en Vista de Intensidades
          this.engine.clearActiveEvent();
          this.engine.setLastSavedEvent({ ...ev, isManualClick: true });
          // Si es internacional, permitir mayor nivel de zoom al encuadrar el epicentro
          const targetZoom = isInter ? 2.8 : 1.4;
          this.engine.focusOnCoordinates(ev.latitude || ev.lat, ev.longitude || ev.lon, targetZoom);
          if (typeof window.switchSidebarTab === 'function') {
            window.switchSidebarTab('intensities');
          }

          // Resaltar visualmente la tarjeta seleccionada
          listEl.querySelectorAll('.history-card-item').forEach((c) => {
            c.style.borderColor = '#233448';
          });
          item.style.borderColor = '#38bdf8';
        }
      });
    });

    // 2. Renderizado para la tarjeta de Historial Sísmico en teléfonos móviles (capturas)
    const mobileListEl = document.getElementById('mobileHistoryList');
    if (mobileListEl) {
      if (!this.earthquakes || this.earthquakes.length === 0) {
        mobileListEl.innerHTML = `
          <div style="color: #64748b; font-size: 11px; text-align: center; padding: 20px;">
            ${t('sidebar.noEvents')}
          </div>
        `;
      } else {
        const lastSavedId = this.engine?.state?.lastSavedEvent?.id;
        mobileListEl.innerHTML = sortedEvents.map((ev) => {
          const intVal = Math.max(1, Math.min(10, Math.round(ev.maxIntensity || 1)));
          const roman = formatIntensity(intVal);
          const theme = getIntensityTheme(intVal);

          const d = ev.time ? new Date(ev.time) : new Date();
          const dateStr = formatEventDate(d);
          const timeStr = '';

          const isInter = Boolean(
            ev.isInter ||
            ev.category === 'inter' ||
            (ev.source && (ev.source.toLowerCase().includes('inter') || ev.source.toLowerCase().includes('usgs')))
          );
          const isSelected = lastSavedId === ev.id;

          return `
            <div class="mob-history-card ${isSelected ? 'selected' : ''}" data-eq-id="${ev.id}">
              <div class="mob-hist-int-badge" style="background: ${theme.bg}; color: ${theme.text}; box-shadow: 0 0 6px ${theme.bg}44;">
                <span class="mob-hist-int-lbl" style="color: ${theme.text};">INT</span>
                <span class="mob-hist-int-num" style="color: ${theme.text};">${roman}</span>
              </div>
              <div class="mob-hist-info">
                <div class="mob-hist-top-line">
                  <span class="mob-hist-title" title="${ev.location}">${ev.location}</span>
                  ${isSelected ? `<span class="mob-btn-map-active">${t('map.viewOnMap')}</span>` : ''}
                </div>
                <div class="mob-hist-time">${dateStr} ${timeStr}</div>
                <div class="mob-hist-metrics">
                  <span class="mob-chip">
                    <span class="mob-bar-cyan"></span>
                    ${ev.depth} km
                  </span>
                  <span class="mob-chip">
                    <span class="mob-bar-yellow"></span>
                    M ${Number(ev.magnitude || ev.mag || 0).toFixed(1)}
                  </span>
                  ${isInter ? '<span style="background: rgba(56, 189, 248, 0.22); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.55); padding: 0 3px; border-radius: 3px; font-size: 8px; font-weight: 700;">🌐 INTER</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');

        // Eventos táctiles y de clic para la tarjeta móvil
        mobileListEl.querySelectorAll('.mob-history-card').forEach((item) => {
          item.addEventListener('click', () => {
            const id = item.getAttribute('data-eq-id');
            const ev = this.earthquakes.find((e) => e.id === id);
            if (ev) {
              const isInter = Boolean(
                ev.isInter ||
                ev.category === 'inter' ||
                (ev.source && (ev.source.toLowerCase().includes('inter') || ev.source.toLowerCase().includes('usgs')))
              );
              this.engine.clearActiveEvent();
              this.engine.setLastSavedEvent({ ...ev, isManualClick: true });
              const targetZoom = isInter ? 2.8 : 1.4;
              this.engine.focusOnCoordinates(ev.latitude || ev.lat, ev.longitude || ev.lon, targetZoom);
              this.renderEarthquakeHistory();
            }
          });
        });
      }
    }
  }

  simulateSeismicDetection() {
    this.closeSeedlinkModal();
    console.log('[SeedLinkUI] Solicitando simulación de sismo al servidor...');
    fetch('/api/seedlink/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok && data.event) {
          this.handleEarthquakeDetected(data.event);
        } else {
          throw new Error(data?.error || 'Respuesta inválida');
        }
      })
      .catch((err) => {
        console.warn('[SeedLinkUI] Fallback local para simulación de sismo:', err);
        const fallbackEvent = {
          id: `eq-${Date.now()}`,
          time: new Date().toISOString(),
          latitude: 16.85,
          longitude: -99.90,
          magnitude: 6.6,
          depth: 15,
          location: 'Costa de Guerrero (Cerca de Acapulco)',
          maxIntensity: 6,
          stationCount: 9,
          source: t('seedlink.simDetection'),
        };
        this.handleEarthquakeDetected(fallbackEvent);
      });
  }

  showSismosMpNotification(data) {
    if (!data) return;
    const code = data.code || 'wawa';
    const message = data.message || t('seedlink.sismosmpDefault');
    const source = data.source || 'SismosMP';
    const timeStr = data.timeStr || new Date().toLocaleTimeString(getLocale());

    // 1. Mostrar en la consola del navegador
    console.log(
      `%c[SismosMP] 📡 SEÑAL RECIBIDA: ${code} %c${message} (${timeStr})`,
      'background: #0284c7; color: #ffffff; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
      'background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 4px;'
    );

    // 2. Reproducir tono corto 'pip' si el audio está activo
    try {
      if (this.engine?.audioManager) {
        this.engine.audioManager.playPing();
      }
    } catch (_) {}

    // 3. Crear o reutilizar contenedor de notificaciones en el monitor
    let toastContainer = document.getElementById('sismosmpToastContainer');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'sismosmpToastContainer';
      toastContainer.style.cssText = `
        position: fixed;
        top: 65px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #06b6d4;
      box-shadow: 0 8px 24px rgba(6, 182, 212, 0.25);
      border-radius: 8px;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      pointer-events: auto;
      animation: sismosmpSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      backdrop-filter: blur(8px);
      max-width: 420px;
    `;

    toast.innerHTML = `
      <div style="width: 32px; height: 32px; border-radius: 6px; background: rgba(6, 182, 212, 0.2); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">
        📡
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-weight: 700; color: #38bdf8; letter-spacing: 0.5px;">[SismosMP]</span>
          <span style="background: #0284c7; color: #fff; font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 3px; font-family: monospace;">${code}</span>
          <span style="font-size: 10px; color: #94a3b8; margin-left: auto;">${timeStr}</span>
        </div>
        <div style="font-size: 12px; color: #e2e8f0; font-weight: 500;">
          ${message}
        </div>
      </div>
    `;

    toastContainer.appendChild(toast);

    // Auto-eliminar después de 6 segundos con animación de salida
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.4s ease';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 400);
    }, 6000);
  }
}
