/**
 * =========================================================================
 * endpoint de mi bebe sismosmp uwu (sismosmp.app / monitor.sismosmex.com)
 * =========================================================================
 */

import { IncomingMessage, ServerResponse } from 'http';
import { SeedLinkService } from '../seedlink/service';

export function handleSismosMpEndpoint(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Solo capturar rutas de SismosMP
  if (!url.startsWith('/api/sismosmp') && !url.startsWith('/api/seedlink/sismosmp')) {
    return false;
  }

  const service = SeedLinkService.getInstance();
  const REQUIRED_API_KEY = process.env.SISMOSMP_API_KEY || 'smp_sec_99a8f27b4e124c88';

  const reqOrigin = (req.headers['origin'] as string) || '';
  const allowedOrigins = ['https://sismosmp.app', 'https://sismosmp.app', 'https://monitor.sismosmex.com'];
  const allowOriginHeader = allowedOrigins.includes(reqOrigin) ? reqOrigin : '*';

  const sendJson = (statusCode: number, data: any) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', allowOriginHeader);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
    res.end(JSON.stringify(data));
  };

  // Pre-flight CORS (OPTIONS)
  if (method === 'OPTIONS') {
    sendJson(200, { ok: true });
    return true;
  }

  // Validador q si sea
  const isAuthorized = (queryKey?: string | null, payloadKey?: string | null): boolean => {
    const headerKey = (req.headers['x-api-key'] as string) || '';
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    // 1. Verificación por API 
    if (
      headerKey === REQUIRED_API_KEY ||
      bearerKey === REQUIRED_API_KEY ||
      queryKey === REQUIRED_API_KEY ||
      payloadKey === REQUIRED_API_KEY
    ) {
      return true;
    }

    // 2. Verificación por Dominio 
    const origin = (req.headers['origin'] as string) || '';
    const referer = (req.headers['referer'] as string) || '';
    const allowedHosts = ['sismosmp.app', 'www.sismosmp.app', 'monitor.sismosmex.com', 'localhost'];

    const matchesDomain = allowedHosts.some((h) => origin.includes(h) || referer.includes(h));
    if (matchesDomain) {
      return true;
    }

    return false;
  };

  // -------------------------------------------------------------
  //obtener la mamada esa osea el get w (/api/sismosmp?code=Eqw&msg=texto&key=xxx)
  // -------------------------------------------------------------
  if (method === 'GET') {
    const parsedUrl = new URL(url, 'http://localhost');
    const apiKey = parsedUrl.searchParams.get('key') || parsedUrl.searchParams.get('apiKey');

    if (!isAuthorized(apiKey)) {
      sendJson(401, {
        ok: false,
        error: 'Acceso no autorizado. Se requiere Header X-API-Key válido o solicitud desde sismosmp.app',
      });
      return true;
    }

    const code = parsedUrl.searchParams.get('code') || 'wawa';
    const message = parsedUrl.searchParams.get('msg') || parsedUrl.searchParams.get('message') || 'sismosMP activo';
    const source = parsedUrl.searchParams.get('source') || 'SismosMP';

    const signal = service.broadcastSismosMpSignal({ code, message, source });
    sendJson(200, {
      ok: true,
      status: 'received',
      signal,
    });
    return true;
  }

  // -------------------------------------------------------------
  // metodo del post (/api/sismosmp con JSON o texto)
  // -------------------------------------------------------------
  if (method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        let payload: any = {};
        if (body && body.trim().startsWith('{')) {
          payload = JSON.parse(body);
        } else if (body && body.trim().length > 0) {
          const text = body.trim();
          payload = {
            code: text.length <= 8 ? text : 'wawa',
            message: text.length > 8 ? text : 'sismosMP activo',
            raw: text,
          };
        }

        if (!isAuthorized(null, payload.apiKey || payload.key)) {
          sendJson(401, {
            ok: false,
            error: 'Acceso no autorizado. Se requiere Header X-API-Key válido o solicitud desde sismosmp.app',
          });
          return;
        }

        const code = payload.code || 'wawa';
        const message = payload.message || payload.msg || 'sismosMP activo';
        const source = payload.source || 'SismosMP';

        const signal = service.broadcastSismosMpSignal({ code, message, source, raw: payload.raw });
        sendJson(200, {
          ok: true,
          status: 'received',
          signal,
        });
      } catch (err: any) {
        sendJson(400, { ok: false, error: err.message });
      }
    });
    return true;
  }

  return false;
}
