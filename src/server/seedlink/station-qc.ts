/**
 * CONTROL DE CALIDAD DE RECEPCIÓN POR FLUJO (red.estación.canal)
 *
 * Un flujo con telemetría defectuosa no debe abrir ni sostener disparos. Detecta:
 *  - Huecos entre paquetes consecutivos. Rompen la continuidad del STA/LTA, así que el flujo se bloquea
 *    durante el asentamiento del filtro. Tres huecos en 10 min bloquean durante más tiempo.
 *  - Muestras planas (una trama con ≥ 90 % de valores repetidos indica digitalizador o enlace atascado).
 *  - Valores no finitos.
 *  - Saltos de reloj: el retardo entre el tiempo del paquete y su llegada cambia más de 60 s de un paquete al siguiente.
 *
 * Todo se mide en tiempo de datos (inicio y fin de paquete), no en tiempo de pared, para que sea determinista.
 */

export type ReceptionGate = 'OK' | 'BLOCKED';

export interface ReceptionPacketInput {
  streamKey: string;
  packetStartMs: number;
  packetEndMs: number;
  prevEndMs: number; // 0 si el flujo no tiene paquete previo
  delaySec: number;
  samples: ArrayLike<number>;
}

export interface ReceptionVerdict {
  gate: ReceptionGate;
  transition: boolean; // true si el control cambió de estado con este paquete
  reasons: string[];
  gapsInWindow: number;
  blockedUntilMs: number;
}

interface StreamQcState {
  gate: ReceptionGate;
  gapTimesMs: number[];
  blockedUntilMs: number;
  lastDelaySec: number | null;
}

const GAP_TOLERANCE_MS = 1500;
const GAP_SETTLE_MS = 60_000;
const GAP_WINDOW_MS = 10 * 60_000;
const REPEATED_GAP_COUNT = 3;
const REPEATED_GAP_BLOCK_MS = 5 * 60_000;
const FLAT_FRACTION = 0.9;
const MIN_FLAT_SAMPLES = 20;
const CLOCK_JUMP_SEC = 60;
const BACKFILL_DELAY_SEC = 180;

export class StationReceptionQc {
  private readonly streams = new Map<string, StreamQcState>();

  public observe(input: ReceptionPacketInput): ReceptionVerdict {
    let s = this.streams.get(input.streamKey);
    if (!s) {
      s = { gate: 'OK', gapTimesMs: [], blockedUntilMs: 0, lastDelaySec: null };
      this.streams.set(input.streamKey, s);
    }

    const reasons: string[] = [];
    const startMs = input.packetStartMs;
    const endMs = input.packetEndMs;

    if (input.prevEndMs > 0 && startMs - input.prevEndMs > GAP_TOLERANCE_MS) {
      s.gapTimesMs = s.gapTimesMs.filter((t) => startMs - t <= GAP_WINDOW_MS);
      s.gapTimesMs.push(startMs);
      reasons.push(`hueco de ${Math.round((startMs - input.prevEndMs) / 1000)} s`);
      const repeated = s.gapTimesMs.length >= REPEATED_GAP_COUNT;
      this.blockUntil(s, startMs + (repeated ? REPEATED_GAP_BLOCK_MS : GAP_SETTLE_MS));
    }

    const delay = input.delaySec;
    if (
      s.lastDelaySec !== null &&
      delay <= BACKFILL_DELAY_SEC &&
      s.lastDelaySec <= BACKFILL_DELAY_SEC &&
      Math.abs(delay - s.lastDelaySec) > CLOCK_JUMP_SEC
    ) {
      reasons.push(`salto de latencia/reloj de ${Math.round(delay - s.lastDelaySec)} s`);
      this.blockUntil(s, endMs + GAP_SETTLE_MS);
    }
    s.lastDelaySec = delay;

    const flat = this.inspectSamples(input.samples);
    if (flat.nonFinite > 0) {
      reasons.push(`${flat.nonFinite} valores no finitos`);
      this.blockUntil(s, endMs + GAP_SETTLE_MS);
    }
    if (flat.repeatFraction >= FLAT_FRACTION) {
      reasons.push(`muestras planas (${Math.round(flat.repeatFraction * 100)} % repetidas)`);
      this.blockUntil(s, endMs + GAP_SETTLE_MS);
    }

    const gate: ReceptionGate = startMs < s.blockedUntilMs ? 'BLOCKED' : 'OK';
    const transition = gate !== s.gate;
    s.gate = gate;

    return {
      gate,
      transition,
      reasons,
      gapsInWindow: s.gapTimesMs.length,
      blockedUntilMs: s.blockedUntilMs,
    };
  }

  private blockUntil(s: StreamQcState, untilMs: number): void {
    if (untilMs > s.blockedUntilMs) s.blockedUntilMs = untilMs;
  }

  private inspectSamples(samples: ArrayLike<number>): { repeatFraction: number; nonFinite: number } {
    const n = samples.length;
    if (n < MIN_FLAT_SAMPLES) return { repeatFraction: 0, nonFinite: 0 };
    let repeats = 0;
    let nonFinite = 0;
    let prev = samples[0];
    for (let i = 0; i < n; i++) {
      const v = samples[i];
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      if (i > 0 && v === prev) repeats++;
      prev = v;
    }
    return { repeatFraction: repeats / n, nonFinite };
  }
}
