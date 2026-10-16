/**
 * SERVIDOR DE PRODUCCIÓN HTTP Y WEBSOCKET (PORT 3000)
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import express from 'express';
import { WebSocketServer } from 'ws';
import { SeedLinkService } from './src/server/seedlink/service';
import { handleSeedLinkApiRequest } from './src/server/seedlink/api-router';

const app = express();
const server = http.createServer(app);

// Inicializar servicio SeedLink
const seedLinkService = SeedLinkService.getInstance();

// Servidor WebSocket en /ws
const wss = new WebSocketServer({ server, path: '/ws' });
seedLinkService.attachWebSocketServer(wss);

// Middleware para API SeedLink
app.use((req, res, next) => {
  if (handleSeedLinkApiRequest(req, res)) {
    return;
  }
  next();
});

// Servir archivos estáticos únicamente de dist y public (evitando exponer process.cwd() con fuentes o .env)
const distPath = path.join(process.cwd(), 'dist');
const publicPath = path.join(process.cwd(), 'public');
const designMapPath = path.join(process.cwd(), 'desing', 'map');
app.use(express.static(distPath));
app.use(express.static(publicPath));
// El bundle de producción carga las capas GeoJSON del mapa mediante fetch.
// Exponer únicamente ese directorio evita publicar el resto de las fuentes.
app.use('/desing/map', express.static(designMapPath));

// Fallback SPA
app.get('/{*splat}', (req, res) => {
  const indexHtml = path.join(distPath, 'index.html');
  res.sendFile(indexHtml, (err) => {
    if (err) {
      res.sendFile(path.join(process.cwd(), 'index.html'));
    }
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Monitor Sísmico escuchando en http://0.0.0.0:${PORT}`);
  console.log(`[Server] WebSocket activo en ws://0.0.0.0:${PORT}/ws`);
  console.log(`[Server] Identificador de Arranque: ${seedLinkService.serverBootId}`);
  console.log(`===================================================================`);
  console.log(`⚡ CONSOLA DE COMANDOS DEL SERVIDOR SÍSMICO ACTIVA:`);
  console.log(`   * cancel [ID]     -> Cancela sismo activo y emite desconfirmacion.mp3`);
  console.log(`   * list / sismos   -> Muestra sismos en curso con sus IDs`);
  console.log(`   * sim [mag]       -> Simula un sismo de prueba (ej: sim 6.2)`);
  console.log(`   * alerta [stop]   -> Dispara o detiene la Alerta Sísmica`);
  console.log(`   * help / ayuda    -> Muestra la lista de comandos`);
  console.log(`===================================================================`);
});

// Inicializar interfaz de línea de comandos (Terminal CLI)
try {
  if (process.stdin.isTTY || process.env.NODE_ENV !== 'test') {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const [command, ...args] = trimmed.split(/\s+/);
      const cmd = command.toLowerCase();
      const argStr = args.join(' ');

      switch (cmd) {
        case 'cancel':
        case 'cancelar':
        case 'descartar': {
          const targetId = argStr.trim() || undefined;
          console.log(`\n[Terminal CLI] 🛑 Ejecutando cancelación de sismo${targetId ? ` [${targetId}]` : ' activo'}...`);
          const result = seedLinkService.cancelActiveEarthquake(targetId);
          console.log(`[Terminal CLI] 🔔 Resultado: ${result.message}`);
          console.log(`[Terminal CLI] 🔊 Tono 'desconfirmacion.mp3' transmitido a todos los clientes web.`);
          break;
        }

        case 'list':
        case 'sismos':
        case 'activos':
        case 'status': {
          const active = seedLinkService.getActiveEarthquakes();
          console.log(`\n[Terminal CLI] 📋 Sismos Activos en este momento: ${active.length}`);
          if (active.length === 0) {
            console.log(`   (No hay sismos en curso en este momento)`);
          } else {
            active.forEach((ev, i) => {
              console.log(
                `   ${i + 1}. ID: ${ev.id} | Código: [${ev.displayId}] | M ${ev.magnitude} | ${ev.location} | Prof: ${ev.depth} km | Estado: ${ev.status} | Hace ${ev.elapsedSec}s`
              );
            });
            console.log(`   💡 Para cancelar uno escribe: cancel <ID> (ejemplo: cancel ${active[0].displayId})`);
          }
          break;
        }

        case 'sim':
        case 'simular': {
          const mag = parseFloat(args[0]) || 5.8;
          const lat = parseFloat(args[1]) || 16.85;
          const lon = parseFloat(args[2]) || -99.90;
          console.log(`\n[Terminal CLI] 🚀 Iniciando simulación de sismo M ${mag} en (${lat}, ${lon})...`);
          const ev = seedLinkService.getDetector().simulateSeismicEvent({
            magnitude: mag,
            latitude: lat,
            longitude: lon,
            status: 'PRELIMINARY',
          });
          console.log(`[Terminal CLI] ⚡ Sismo simulado generado: ID: ${ev.id} [${ev.displayId}], ${ev.location}, M ${ev.magnitude}`);
          console.log(`[Terminal CLI] 💡 Puedes cancelarlo en cualquier momento con: cancel ${ev.displayId}`);
          break;
        }

        case 'alerta':
        case 'sas':
        case 'alerta-sismica': {
          if (args[0] && args[0].toLowerCase() === 'stop') {
            console.log(`\n[Terminal CLI] 🛑 Deteniendo Alerta Sísmica...`);
            seedLinkService.broadcastWebSocket({ type: 'stop_alerta_sismica' });
            console.log(`[Terminal CLI] ✅ Alerta detenida en todos los monitores.`);
          } else {
            const duracion = parseInt(args[0], 10) || 45;
            console.log(`\n[Terminal CLI] 🚨 Emitiendo Alerta Sísmica (${duracion}s)...`);
            seedLinkService.broadcastWebSocket({
              type: 'trigger_alerta_sismica',
              duracion,
              tipo: 'ALERTA SISMICA',
              nivel: 'SEVERA',
              estados: 'all',
            });
            console.log(`[Terminal CLI] ✅ Alerta emitida exitosamente.`);
          }
          break;
        }

        case 'narrar':
        case 'voz':
        case 'speak': {
          const phrase = argStr.trim() || 'Aviso de alerta sísmica. Zonas en prevención: Guerrero, Michoacán y Valle de México.';
          console.log(`\n[Terminal CLI] 🗣️ Transmitiendo locución de prueba al narrador de los monitores: "${phrase}"`);
          seedLinkService.broadcastWebSocket({
            type: 'narrator_speak',
            text: phrase,
          });
          break;
        }

        case 'clear':
        case 'cls': {
          console.clear();
          break;
        }

        case 'help':
        case 'ayuda':
        case '?': {
          console.log(`\n================== COMANDOS DE CONSOLA DISPONIBLES ==================`);
          console.log(`  cancel [ID]         - Cancela el sismo activo (o por ID) y reproduce desconfirmacion.mp3`);
          console.log(`  list / sismos       - Lista los sismos en curso con sus IDs y tiempo transcurrido`);
          console.log(`  sim [mag] [lat lon] - Simula un sismo de prueba (ej: sim 6.5)`);
          console.log(`  alerta [duracion]   - Emite la Alerta Sísmica`);
          console.log(`  alerta stop         - Detiene la Alerta Sísmica`);
          console.log(`  narrar [frase]      - Emite locución robótica del narrador sísmico`);
          console.log(`  clear               - Limpia la pantalla de la consola`);
          console.log(`=====================================================================`);
          break;
        }

        default: {
          console.log(`[Terminal CLI] Comando desconocido: "${trimmed}". Escribe "help" o "ayuda" para ver la lista.`);
        }
      }
    });
  }
} catch (e) {
  console.warn('[Server] No se pudo inicializar terminal interactiva:', e);
}

// Notificar a todos los clientes web para que se refresquen cuando el servidor se actualice o reinicie
const handleServerShutdown = (signal: string) => {
  console.log(`[Server] Señal recibida: ${signal}. Notificando a todos los clientes para refresco automático...`);
  try {
    seedLinkService.flushNoiseProfiles();
  } catch (_) {}
  try {
    seedLinkService.broadcastClientReload(`server_shutdown_${signal}`);
  } catch (_) {}
};

process.on('SIGTERM', () => handleServerShutdown('SIGTERM'));
process.on('SIGINT', () => handleServerShutdown('SIGINT'));
