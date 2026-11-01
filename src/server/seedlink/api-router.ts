/**
 * RUTAS DE API REST PARA SEEDLINK
 * Provee endpoints para consultar estado de servidores (timeout 20s),
 * telemetría de estaciones (aceleración, amplitud, estado, delay, PGA),
 * oscilogramas Swarm y reconexión manual.
 */

import { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { SeedLinkService } from './service';
import { handleSismosMpEndpoint } from '../sismosmp/endpoint';
import { SeismicNarratorService } from './narrator-service';
import { getSsnHistory } from './ssn-history';

export function handleSeedLinkApiRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const rawUrl = req.url || '';
  const url = rawUrl.split('?')[0];
  const method = req.method || 'GET';

  // Si la petición es para el endpoint independiente de SismosMP, delegar al módulo dedicado
  if (url.startsWith('/api/sismosmp') || url.startsWith('/api/seedlink/sismosmp')) {
    return handleSismosMpEndpoint(req, res);
  }

  if (
    !url.startsWith('/api/seedlink') &&
    !url.startsWith('/api/server') &&
    !url.startsWith('/api/system') &&
    !url.startsWith('/api/alerta-sismica') &&
    !url.startsWith('/api/reload-clients') &&
    !url.startsWith('/api/tsunami') &&
    !url.startsWith('/api/coastal-zones') &&
    !url.startsWith('/api/narrator')
  ) {
    return false;
  }

  const service = SeedLinkService.getInstance();

  const sendJson = (statusCode: number, data: any) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
    res.end(JSON.stringify(data));
  };

  // P-25: Helper de autenticación para endpoints administrativos y críticos
  const isAuthorizedAdmin = (queryKey?: string | null, payloadKey?: string | null): boolean => {
    const adminKey = process.env.ADMIN_API_KEY || process.env.SISMOSMP_API_KEY;
    // Si no hay clave configurada en entorno, permitir únicamente en desarrollo local
    if (!adminKey) {
      const host = (req.headers['host'] || '').toLowerCase();
      return host.includes('localhost') || host.includes('127.0.0.1');
    }

    const headerKey = (req.headers['x-api-key'] as string) || '';
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    return (
      headerKey === adminKey ||
      bearerKey === adminKey ||
      queryKey === adminKey ||
      payloadKey === adminKey
    );
  };

  if (method === 'OPTIONS') {
    sendJson(200, { ok: true });
    return true;
  }

  // GET /api/seedlink/servers (Lista de los 25 servidores con timeout 20s y estado Done / Error)
  if (url === '/api/seedlink/servers' && method === 'GET') {
    sendJson(200, {
      count: service.getServersStatus().length,
      timeoutSec: 20,
      servers: service.getServersStatus(),
    });
    return true;
  }

  // GET /api/seedlink/stations (Todas las estaciones con aceleración, amplitud, estado, delay y PGA)
  if (url === '/api/seedlink/stations' && method === 'GET') {
    sendJson(200, service.getAllStationStates());
    return true;
  }

  // GET /api/seedlink/noise[?station=CODE] (Perfiles de ruido calibrados por canal: clase, umbrales, penalización y cuarentena)
  if (url === '/api/seedlink/noise' && method === 'GET') {
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const profiles = service.getNoiseProfiles(parsedUrl.searchParams.get('station') || '');
    sendJson(200, { ok: true, count: profiles.length, profiles });
    return true;
  }

  // POST /api/seedlink/noise/reset {station} (Borra el perfil de ruido de una estación para recalibrarla)
  if (url === '/api/seedlink/noise/reset' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado. Se requiere token o API key de administración.' });
          return;
        }
        const station = String(payload.station || '').trim();
        if (!station) {
          sendJson(400, { ok: false, error: 'Falta el código de estación (station).' });
          return;
        }
        sendJson(200, { ok: true, removedStreams: service.resetNoiseProfile(station) });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // GET /api/seedlink/status
  if (url === '/api/seedlink/status' && method === 'GET') {
    const servers = service.getServersStatus();
    const doneCount = servers.filter(s => s.status === 'Done').length;
    sendJson(200, {
      totalServers: servers.length,
      connectedServers: doneCount,
      timeoutSec: 20,
      servers,
    });
    return true;
  }

  // GET /api/seedlink/waveform?station=CODE
  if (url.startsWith('/api/seedlink/waveform') && method === 'GET') {
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const station = parsedUrl.searchParams.get('station') || '';
    const points = service.getStationWaveform(station);
    const state = service.getStationState(station);
    sendJson(200, {
      station,
      count: points.length,
      waveform: points,
      channel: state?.primaryChannel,
      sampleRate: state?.sampleRate,
    });
    return true;
  }

  // GET /api/seedlink/events (Historial del monitor desde MongoDB; si no carga, historial del SSN)
  // GET /api/seedlink/events/ssn (Historial del SSN, siempre)
  // Cabecera X-History-Source indica la fuente real: "mongodb" o "ssn".
  if (url === '/api/seedlink/events' && method === 'GET') {
    if (service.isMonitorHistoryReady()) {
      res.setHeader('X-History-Source', 'mongodb');
      sendJson(200, service.getEarthquakeHistory());
    } else {
      getSsnHistory().then((events) => {
        res.setHeader('X-History-Source', 'ssn');
        sendJson(200, events);
      });
    }
    return true;
  }

  if (url === '/api/seedlink/events/ssn' && method === 'GET') {
    getSsnHistory().then((events) => {
      res.setHeader('X-History-Source', 'ssn');
      sendJson(200, events);
    });
    return true;
  }

  // DELETE /api/seedlink/events o POST /api/seedlink/clear-events (Elimina todo el historial sísmico)
  if ((url === '/api/seedlink/events' && method === 'DELETE') ||
      (url === '/api/seedlink/clear-events' && method === 'POST')) {
    if (!isAuthorizedAdmin()) {
      sendJson(403, { ok: false, error: 'No autorizado. Se requiere token o API key de administración.' });
      return true;
    }
    service.clearEarthquakeHistory();
    sendJson(200, { ok: true, message: 'Historial sísmico eliminado exitosamente' });
    return true;
  }

  // GET /api/seedlink/active-events (Lista de sismos en curso)
  if (url === '/api/seedlink/active-events' && method === 'GET') {
    const active = service.getActiveEarthquakes();
    sendJson(200, { ok: true, count: active.length, events: active });
    return true;
  }

  // POST /api/seedlink/cancel-event o POST /api/seedlink/cancel o GET /api/seedlink/cancel?id=... (Cancela sismos activos)
  if (
    (url === '/api/seedlink/cancel-event' || url === '/api/seedlink/cancel' || url === '/api/cancel-event') &&
    (method === 'POST' || method === 'GET')
  ) {
    if (method === 'GET') {
      const parsedUrl = new URL(rawUrl, 'http://localhost');
      const key = parsedUrl.searchParams.get('key');
      if (!isAuthorizedAdmin(key)) {
        sendJson(403, { ok: false, error: 'No autorizado. Se requiere token de administración.' });
        return true;
      }
      const identifier = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('identifier') || '';
      const result = service.cancelActiveEarthquake(identifier);
      sendJson(200, { ok: true, data: result });
      return true;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado. Se requiere token de administración.' });
          return;
        }
        const identifier = payload.id || payload.identifier || payload.eventId || payload.displayId || '';
        const result = service.cancelActiveEarthquake(identifier);
        sendJson(200, { ok: true, data: result });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // POST /api/seedlink/simulate-event probar y asi
  if (url === '/api/seedlink/simulate-event' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado para simulación. Proporcione API Key válida.' });
          return;
        }
        const ev = service.getDetector().simulateSeismicEvent(payload);
        sendJson(200, { ok: true, event: ev });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // POST /api/seedlink/alerta-sismica (Activación remota de Alerta Sísmica vía CLI / API)
  if ((url === '/api/seedlink/alerta-sismica' || url === '/api/alerta-sismica') && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado para emitir alertas públicas.' });
          return;
        }
        const tipo = String(payload.tipo || payload.type || 'ALERTA SISMICA');
        const duracion = Number(payload.duracion || payload.duration || 30);
        const nivel = String(payload.nivel || payload.level || 'SEVERA');
        const estados = payload.estados || payload.states || 'all';

        if (payload.stop || tipo.toUpperCase() === 'STOP' || tipo.toUpperCase() === 'DETENER' || duracion <= 0) {
          console.log('[SeedLinkService] Alerta Sísmica detenida vía API/CLI');
          service.broadcastWebSocket({ type: 'stop_alerta_sismica' });
          sendJson(200, { ok: true, message: 'Alerta Sísmica detenida en todos los monitores' });
          return;
        }

        console.log(`[SeedLinkService] Alerta Sísmica emitida vía API/CLI: Tipo=${tipo}, Nivel=${nivel}, Duración=${duracion}s`);
        service.broadcastWebSocket({
          type: 'trigger_alerta_sismica',
          duracion,
          tipo,
          nivel,
          estados,
        });

        sendJson(200, {
          ok: true,
          message: 'Alerta Sísmica emitida exitosamente a los monitores conectados',
          data: { duracion, tipo, nivel, estados },
        });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // GET /api/seedlink/simulacro-nacional (Estado del 2° Simulacro Nacional del 19 de Septiembre 12:00 PM)
  if (url === '/api/seedlink/simulacro-nacional' && method === 'GET') {
    const status = service.getNationalDrillStatus();
    sendJson(200, { ok: true, data: status });
    return true;
  }

  // POST /api/seedlink/simulacro-nacional (Disparar Simulacro Nacional manualmente o de prueba)
  if (url === '/api/seedlink/simulacro-nacional' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado para activar el simulacro nacional.' });
          return;
        }
        const duracion = Number(payload.duracion || 60);
        const drillData = service.triggerNationalDrill(duracion);
        sendJson(200, {
          ok: true,
          message: '2° Simulacro Nacional emitido exitosamente a todos los monitores',
          data: drillData
        });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // POST /api/seedlink/reconnect
  if (url === '/api/seedlink/reconnect' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado para reconectar servidores remotamente.' });
          return;
        }
        service.reconnectServer(payload.serverId);
        sendJson(200, { ok: true, message: 'Reconexión iniciada' });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // GET /api/server/version y /api/system/version (Versión de arranque del servidor para auto-refresh)
  if ((url === '/api/server/version' || url === '/api/system/version' || url === '/api/seedlink/version' || url === '/api/version') && method === 'GET') {
    sendJson(200, {
      ok: true,
      serverBootId: service.serverBootId,
      serverStartTime: service.serverStartTime,
      uptime: process.uptime(),
    });
    return true;
  }

  // POST /api/server/reload-clients y /api/reload-clients (Refrescar todos los clientes conectados)
  if ((url === '/api/server/reload-clients' || url === '/api/reload-clients' || url === '/api/seedlink/reload-clients') && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const reason = payload.reason || 'manual_request';
        service.broadcastClientReload(reason);
        sendJson(200, {
          ok: true,
          message: 'Orden de recarga difundida exitosamente a todos los clientes web',
          serverBootId: service.serverBootId,
        });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // GET /api/tsunami/status y /api/seedlink/tsunami/status
  if ((url === '/api/tsunami/status' || url === '/api/seedlink/tsunami/status') && method === 'GET') {
    const activeAlert = service.getActiveTsunamiAlert();
    sendJson(200, {
      ok: true,
      active: !!activeAlert,
      alert: activeAlert,
    });
    return true;
  }

  // POST /api/tsunami/alert y /api/seedlink/tsunami/alert (Activar / Emitir Alerta de Tsunami)
  if ((url === '/api/tsunami/alert' || url === '/api/seedlink/tsunami/alert') && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!isAuthorizedAdmin(null, payload.key || payload.apiKey)) {
          sendJson(403, { ok: false, error: 'No autorizado para emitir alertas de tsunami.' });
          return;
        }
        const emitted = service.emitTsunamiAlert(payload);
        sendJson(200, {
          ok: true,
          message: 'Alerta de Tsunami emitida exitosamente a todos los monitores',
          alert: emitted,
        });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  // POST /api/tsunami/stop y /api/seedlink/tsunami/stop (Detener / Cancelar Alerta de Tsunami)
  if ((url === '/api/tsunami/stop' || url === '/api/seedlink/tsunami/stop') && method === 'POST') {
    if (!isAuthorizedAdmin()) {
      sendJson(403, { ok: false, error: 'No autorizado para detener alertas de tsunami.' });
      return true;
    }
    service.stopTsunamiAlert();
    sendJson(200, {
      ok: true,
      message: 'Alerta de Tsunami cancelada en todos los monitores',
    });
    return true;
  }

  // GET /api/coastal-zones y /api/seedlink/coastal-zones
  if ((url === '/api/coastal-zones' || url === '/api/seedlink/coastal-zones') && method === 'GET') {
    try {
      const filePath = path.resolve('desing/map/coastal-zones.json');
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(data);
        return true;
      }
    } catch (_) {}
    sendJson(200, []);
    return true;
  }

  // POST /api/narrator/speak o /api/seedlink/narrator/speak (Sintetizar voz con Fish Audio API o caché)
  if ((url === '/api/narrator/speak' || url === '/api/seedlink/narrator/speak') && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = (payload.text || '').trim();
        if (!text) {
          sendJson(400, { ok: false, error: 'Texto requerido' });
          return;
        }

        const narrator = SeismicNarratorService.getInstance();
        const language = typeof payload.lang === 'string' ? payload.lang : 'es';
        const { audioBuffer, mimeType, cached } = await narrator.synthesizeSpeech(text, language);

        if (audioBuffer && audioBuffer.length > 0) {
          res.statusCode = 200;
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Length', audioBuffer.length);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('X-Narrator-Cached', cached ? 'true' : 'false');
          res.setHeader('X-Narrator-Engine', 'FishAudio');
          res.end(audioBuffer);
        } else {
          // Si Fish Audio no tiene saldo o falló, avisar para fallback de síntesis en cliente
          sendJson(200, {
            ok: false,
            fallbackWebSpeech: true,
            text,
            message: 'Fish Audio no disponible temporalmente. Usando síntesis robótica nativa Web Speech.',
          });
        }
      } catch (err: any) {
        sendJson(500, { ok: false, error: err.message, fallbackWebSpeech: true });
      }
    });
    return true;
  }

  // GET /api/narrator/status (Estado del Narrador y disponibilidad de Fish Audio)
  if ((url === '/api/narrator/status' || url === '/api/seedlink/narrator/status') && method === 'GET') {
    sendJson(200, {
      ok: true,
      service: 'Fish Audio S2.1 Pro Free + Web Speech Fallback',
      model: 's2.1-pro-free',
      referenceIds: SeismicNarratorService.getInstance().getReferenceIds(),
    });
    return true;
  }

  return false;
}
