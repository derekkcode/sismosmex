#!/usr/bin/env node

/**
 * CLI para activar Alerta Sísmica / Simulacro desde la Terminal del Servidor
 * Admite cualquier orden de parámetros:
 *   node alert.js SIMULACRO MODERADA
 *   node alert.js 45 SIMULACRO MODERADA
 *   node alert.js 30 "ALERTA SISMICA" SEVERA
 *   node alert.js stop
 */

import http from 'http';

const rawArgs = process.argv.slice(2);

const isStop = rawArgs.some(a => ['stop', 'detener', 'cancel', 'cancelar', 'off'].includes(a.toLowerCase()));

let duracion = 30;
let tipo = 'ALERTA SISMICA';
let nivel = 'SEVERA';
let estados = 'all';

if (isStop) {
  tipo = 'STOP';
  duracion = 0;
} else {
  const recognizedLevels = [
    'SEVERA', 'EXTREMA', 'CRITICA', 'FUERTE', 'PUBLICA', 'PÚBLICA', 'ROJA', 'ROJO',
    'MODERADA', 'PREVENTIVA', 'NARANJA', 'MEDIA',
    'LEVE', 'BAJA', 'AMARILLA', 'AMARILLO',
    'INFORMATIVA', 'VERDE'
  ];

  for (const arg of rawArgs) {
    const clean = arg.trim();
    const upper = clean.toUpperCase();

    // 1. Es un número -> Duración
    if (/^\d+$/.test(clean)) {
      duracion = parseInt(clean, 10);
      continue;
    }

    // 2. Es tipo de alerta (Simulacro o Real)
    if (upper.includes('NACIONAL')) {
      tipo = '2° SIMULACRO NACIONAL 19 SEP';
      duracion = 60;
      nivel = 'MODERADA';
      estados = 'CDMX, Guerrero, Oaxaca, Puebla, Morelos, Michoacán, Jalisco, Colima, Veracruz, Chiapas, Tlaxcala, Edomex';
      continue;
    }
    if (upper.includes('SIMULACR')) {
      tipo = 'SIMULACRO';
      continue;
    }
    if (upper.includes('ALERTA') || upper === 'REAL') {
      tipo = 'ALERTA SISMICA';
      continue;
    }

    // 3. Es un nivel de alerta
    if (recognizedLevels.includes(upper) || clean.startsWith('#')) {
      nivel = upper;
      continue;
    }

    // 4. Es lista de estados (ej. CDMX,Guerrero,Oaxaca)
    if (clean.includes(',')) {
      estados = clean.split(',').map(s => s.trim());
      continue;
    }
  }

  // Si se eligió simulacro y no se especificó duración, dar 45s por defecto
  if (tipo === 'SIMULACRO' && !rawArgs.some(a => /^\d+$/.test(a.trim()))) {
    duracion = 45;
  }
}

const payload = JSON.stringify({ duracion, tipo, nivel, estados, stop: isStop });

// Puertos candidatos a probar (en contenedores locales Vite/Express suele estar en 3000, 8080 o PORT)
const candidatePorts = Array.from(
  new Set([
    3000,
    process.env.PORT ? Number(process.env.PORT) : null,
    8080,
    80,
    5173
  ])
).filter(Boolean);

async function sendAlertToPort(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: port,
        path: '/api/seedlink/alerta-sismica',
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
      const response = await sendAlertToPort(p);
      if (response && response.ok) {
        success = true;
        console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
        if (isStop) {
          console.log('\x1b[1m\x1b[32m%s\x1b[0m', '  ✅ ALERTA SÍSMICA DETENIDA EN TODOS LOS MONITORES');
        } else {
          console.log('\x1b[1m\x1b[31m%s\x1b[0m', '  🚨 ALERTA SÍSMICA / SIMULACRO ACTIVADO CON ÉXITO');
          console.log('\x1b[32m%s\x1b[0m', '───────────────────────────────────────────────────────────────────');
          console.log(`  • Tipo:     \x1b[33m${tipo}\x1b[0m`);
          console.log(`  • Nivel:    \x1b[35m${nivel}\x1b[0m`);
          console.log(`  • Duración: \x1b[36m${duracion} segundos\x1b[0m`);
          console.log(`  • Estados:  \x1b[37m${Array.isArray(estados) ? estados.join(', ') : estados}\x1b[0m`);
        }
        console.log('\x1b[90m%s\x1b[0m', `  Difundido vía WebSocket en puerto ${p} a todos los clientes web.`);
        console.log('\x1b[32m%s\x1b[0m', '═══════════════════════════════════════════════════════════════════');
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!success) {
    console.error('\x1b[31m[Error de Conexión]:\x1b[0m No se pudo contactar el servicio en los puertos locales ' + candidatePorts.join(', '));
    if (lastError) console.error('Detalle:', lastError.message);
    console.log('\x1b[33mAsegúrate de que la aplicación esté en ejecución.\x1b[0m');
  }
}

main();
