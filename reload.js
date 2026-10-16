#!/usr/bin/env node

/**
 * CLI para forzar el refresco de todos los clientes web conectados al Monitor Sísmico
 * Uso:
 *   node reload.js
 *   node reload.js "Despliegue de nueva versión"
 */

import http from 'http';

const args = process.argv.slice(2);
const reason = args.join(' ') || 'Actualización de Servidor';

const payload = JSON.stringify({ reason });

const candidatePorts = Array.from(
  new Set([
    3000,
    process.env.PORT ? Number(process.env.PORT) : null,
    8080,
    80,
    5173,
  ])
).filter(Boolean);

async function sendReloadToPort(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: port,
        path: '/api/server/reload-clients',
        method: 'POST',
        headers: {
          'Host': `localhost:${port}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 2500,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (_) {
              resolve({ ok: true, raw: data });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  let success = false;
  let lastError = null;

  for (const p of candidatePorts) {
    try {
      const response = await sendReloadToPort(p);
      if (response && response.ok) {
        success = true;
        console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
        console.log('\x1b[1m\x1b[32m%s\x1b[0m', '  🔄 ORDEN DE REFRESCO DIFUNDIDA CON ÉXITO A TODOS LOS CLIENTES');
        console.log('\x1b[32m%s\x1b[0m', '───────────────────────────────────────────────────────────────────');
        console.log(`  • Motivo:    \x1b[33m${reason}\x1b[0m`);
        console.log(`  • Boot ID:   \x1b[36m${response.serverBootId || 'N/A'}\x1b[0m`);
        console.log('\x1b[90m%s\x1b[0m', `  Enviado vía WebSocket en puerto ${p} a todos los clientes web.`);
        console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!success) {
    console.error('\x1b[31m[Error]:\x1b[0m No se pudo contactar el servidor en los puertos ' + candidatePorts.join(', '));
    if (lastError) console.error('Detalle:', lastError.message);
  }
}

main();
