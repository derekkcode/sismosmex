/**
 * CLIENTE TCP SEEDLINK V3 / V4
 * Mantiene la conexión de socket persistente, negocia el handshake ASCII
 * y consume el flujo continuo de tramas MiniSEED binarias de 512 bytes.
 */

import net from 'net';
import { EventEmitter } from 'events';
import { parseMiniSeedRecord, MiniSeedRecord } from './miniseed';

export interface SeedLinkClientConfig {
  host: string;
  port: number;
  stations?: Array<{ code: string; network: string; selector?: string }>;
  channelSelector?: string;
  reconnectDelayMs?: number;
  autoReconnect?: boolean;
}

export interface SeedLinkStats {
  connected: boolean;
  serverVersion: string;
  host: string;
  port: number;
  packetsReceived: number;
  bytesReceived: number;
  bitrateKbps: number;
  lastPacketTime: string | null;
  uptimeSeconds: number;
  errorCount: number;
  activeStationCount: number;
}

export class SeedLinkClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private config: SeedLinkClientConfig;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private handshakeStep: number = 0;
  private isConnected: boolean = false;
  private serverVersion: string = '';
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Estadísticas
  private packetsReceived: number = 0;
  private bytesReceived: number = 0;
  private connectTimestamp: number = 0;
  private lastPacketTime: string | null = null;
  private errorCount: number = 0;
  private bytesInWindow: number = 0;
  private bitrateKbps: number = 0;
  private bitrateInterval: NodeJS.Timeout | null = null;

  constructor(config: SeedLinkClientConfig) {
    super();
    this.config = {
      host: config.host || '132.247.71.12',
      port: config.port || 18000,
      stations: config.stations || [
        { code: 'CUIG', network: 'IG' },
        { code: 'CJIG', network: 'IG' },
        { code: 'GTIG', network: 'IG' },
        { code: 'TLIG', network: 'IG' },
        { code: 'OXIG', network: 'IG' },
        { code: 'TGIG', network: 'IG' },
      ],
      channelSelector: config.channelSelector || '?H?.D',
      reconnectDelayMs: config.reconnectDelayMs || 5000,
      autoReconnect: config.autoReconnect !== false,
    };
  }

  public connect(): void {
    if (this.socket) {
      this.disconnect();
    }

    this.rxBuffer = Buffer.alloc(0);
    this.handshakeStep = 0;

    console.log(`[SeedLink] Conectando a ${this.config.host}:${this.config.port}...`);
    this.emit('connecting', { host: this.config.host, port: this.config.port });

    const socket = new net.Socket();
    this.socket = socket;

    socket.setKeepAlive(true, 10000);
    socket.setTimeout(30000);

    socket.connect(this.config.port, this.config.host, () => {
      this.isConnected = true;
      this.connectTimestamp = Date.now();
      console.log(`[SeedLink] Conectado exitosamente con ${this.config.host}:${this.config.port}`);
      this.emit('connected');

      // Iniciar cálculo de bitrate
      this.startBitrateMeter();

      // Paso 1: Enviar HELLO para obtener versión del servidor
      this.handshakeStep = 1;
      socket.write('HELLO\r\n');
    });

    socket.on('data', (chunk: Buffer) => {
      this.bytesReceived += chunk.length;
      this.bytesInWindow += chunk.length;

      if (this.handshakeStep < 999) {
        this.handleHandshakeData(chunk);
      } else {
        // Fase de transmisión de paquetes binarios
        this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
        this.processPacketBuffer();
      }
    });

    socket.on('error', (err: Error) => {
      this.errorCount++;
      console.warn(`[SeedLink] Error en socket: ${err.message}`);
      this.emit('error', err);
    });

    socket.on('timeout', () => {
      console.warn('[SeedLink] Timeout en socket sin respuesta');
      this.emit('timeout');
      socket.destroy();
    });

    socket.on('close', (hadError: boolean) => {
      this.isConnected = false;
      this.stopBitrateMeter();
      console.log(`[SeedLink] Conexión cerrada. (Error: ${hadError})`);
      this.emit('disconnected', { hadError });

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  private handleHandshakeData(chunk: Buffer): void {
    const text = chunk.toString('ascii');

    if (this.handshakeStep === 1) {
      // Respuesta de HELLO
      this.serverVersion = text.trim().split('\r')[0];
      console.log(`[SeedLink] Versión servidor: ${this.serverVersion}`);
      this.emit('serverVersion', this.serverVersion);

      // Paso 2: Configurar estaciones
      this.sendStationNegotiations();
    } else if (this.handshakeStep === 2) {
      // Respuestas OK a la negociación de estaciones
      if (text.includes('OK')) {
        // Continuar o enviar END
      }
    }
  }

  private sendStationNegotiations(): void {
    if (!this.socket || !this.isConnected) return;

    const stations = this.config.stations || [];
    const defaultSel = this.config.channelSelector || '?H?.D';

    console.log(`[SeedLink] Negociando ${stations.length} estaciones...`);

    // Enviar comandos de estación
    for (const st of stations) {
      // Sintaxis estándar SeedLink: STATION <station_code> <network_code>\r\n
      this.socket.write(`STATION ${st.code} ${st.network}\r\n`);
      const sel = st.selector || defaultSel;
      this.socket.write(`SELECT ${sel}\r\n`);
      this.socket.write(`DATA\r\n`);
    }

    // Paso final: Finalizar fase ASCII e iniciar transmisión binaria ininterrumpida
    this.socket.write('END\r\n');
    this.handshakeStep = 999; // Modo binario
    console.log('[SeedLink] Handshake completado. Esperando paquetes MiniSEED (512 bytes)...');
    this.emit('streamingStarted');
  }

  /**
   * Procesa el buffer binario acumulado extrayendo paquetes de 520 bytes:
   * [8 bytes SeedLink Header (SLxxxxxx)] + [512 bytes MiniSEED record]
   */
  private processPacketBuffer(): void {
    // Un paquete estándar SeedLink mide 520 bytes (8 header + 512 mseed)
    // O si es flujo directo mseed, 512 bytes
    while (this.rxBuffer.length >= 520) {
      // Verificar si inicia con el prefijo "SL"
      if (this.rxBuffer[0] === 0x53 && this.rxBuffer[1] === 0x4c) {
        // Paquete SeedLink estándar
        const slHeader = this.rxBuffer.slice(0, 8).toString('ascii');
        const mseedBytes = this.rxBuffer.slice(8, 520);
        this.rxBuffer = this.rxBuffer.slice(520);

        this.packetsReceived++;
        this.lastPacketTime = new Date().toISOString();

        const record = parseMiniSeedRecord(mseedBytes);
        if (record) {
          this.emit('packet', { slHeader, record });
        }
      } else {
        // Búsqueda de alineación si hubo bytes perdidos
        const nextSl = this.rxBuffer.indexOf('SL');
        if (nextSl !== -1) {
          this.rxBuffer = this.rxBuffer.slice(nextSl);
        } else {
          // Si no hay "SL", revisar si hay una cabecera FSDH directa de 512 bytes
          if (this.rxBuffer.length >= 512) {
            const mseedBytes = this.rxBuffer.slice(0, 512);
            this.rxBuffer = this.rxBuffer.slice(512);
            const record = parseMiniSeedRecord(mseedBytes);
            if (record) {
              this.packetsReceived++;
              this.lastPacketTime = new Date().toISOString();
              this.emit('packet', { slHeader: 'RAW', record });
            }
          } else {
            break;
          }
        }
      }
    }
  }

  private startBitrateMeter(): void {
    this.stopBitrateMeter();
    this.bytesInWindow = 0;
    this.bitrateInterval = setInterval(() => {
      this.bitrateKbps = Number(((this.bytesInWindow * 8) / 1000).toFixed(1));
      this.bytesInWindow = 0;
    }, 1000);
  }

  private stopBitrateMeter(): void {
    if (this.bitrateInterval) {
      clearInterval(this.bitrateInterval);
      this.bitrateInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.config.reconnectDelayMs || 5000;
    console.log(`[SeedLink] Reintentando conexión en ${delay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopBitrateMeter();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (_) {}
      this.socket = null;
    }
    this.isConnected = false;
  }

  public getStats(): SeedLinkStats {
    const uptime = this.isConnected ? Math.floor((Date.now() - this.connectTimestamp) / 1000) : 0;
    return {
      connected: this.isConnected,
      serverVersion: this.serverVersion || 'Desconectado',
      host: this.config.host,
      port: this.config.port,
      packetsReceived: this.packetsReceived,
      bytesReceived: this.bytesReceived,
      bitrateKbps: this.bitrateKbps,
      lastPacketTime: this.lastPacketTime,
      uptimeSeconds: uptime,
      errorCount: this.errorCount,
      activeStationCount: (this.config.stations || []).length,
    };
  }

  public updateConfig(newConfig: Partial<SeedLinkClientConfig>): void {
    const wasConnected = this.isConnected;
    this.config = { ...this.config, ...newConfig };
    if (wasConnected) {
      this.connect();
    }
  }
}
