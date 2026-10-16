/**
 * CALIBRADOR DE RUIDO SÍSMICO POR CANAL (net.sta.cha)
 *
 * Aprende el ruido de fondo real de cada canal y deriva umbrales de disparo propios:
 *  - Histogramas logarítmicos con olvido exponencial (vida media 12 h) del pico de PGA y del pico de
 *    STA/LTA por paquete. Solo se aprende de paquetes que no inician con la estación ya disparada.
 *  - Umbral final = max(umbral base de la red, cuantil 99.5 % del ruido * margen).
 *  - Retroalimentación: un disparo que la red no corrobora sube una penalización; si se repite, el canal
 *    entra en cuarentena temporal. Un disparo corroborado por varias estaciones la reduce.
 *  - Mientras un canal no completa su calibración se usan los umbrales base con un prior más estricto
 *    (Guatemala/INSIVUMEH tiene el prior más alto por ruido cultural, volcánico y glitches de telemetría).
 *  - Los perfiles se guardan en data/noise-profiles.json para no recalibrar tras cada reinicio.
 */

import fs from 'fs';
import path from 'path';

export type NoiseClass = 'CALIBRATING' | 'QUIET' | 'NORMAL' | 'NOISY' | 'VERY_NOISY' | 'QUARANTINED';

export interface NoiseStreamContext {
  network: string;
  station: string;
  channel: string;
}

export interface NoiseBaseThresholds {
  ratio: number;
  minPgaGal: number;
}

export interface NoiseObservation {
  peakPga: number; // gal, pico del paquete con filtros ya asentados
  peakRatio: number; // pico de STA/LTA dentro del paquete
  durationSec: number;
  duringTrigger: boolean; // el paquete inició con la estación ya disparada (evento o tremor, no ruido)
}

export interface NoiseThresholds {
  ready: boolean;
  noiseClass: NoiseClass;
  ratioThreshold: number;
  minPgaGal: number;
  strongMotionGal: number;
  quarantined: boolean;
  penalty: number;
  medianPga: number;
  highPga: number;
}

export interface NoiseStreamSnapshot {
  key: string;
  network: string;
  station: string;
  channel: string;
  noiseClass: NoiseClass;
  ready: boolean;
  observedMin: number;
  medianPgaGal: number;
  highPgaGal: number;
  medianRatio: number;
  highRatio: number;
  ratioThreshold: number | null;
  minPgaGal: number | null;
  penalty: number;
  quarantined: boolean;
  quarantineLeftMin: number;
  falseTriggersLastHour: number;
}

interface NoisePrior {
  ratioMult: number;
  pgaMult: number;
  marginRatio: number;
  marginPga: number;
  calibrationSec: number;
}

const DEFAULT_PRIOR: NoisePrior = {
  ratioMult: 1.15,
  pgaMult: 1.3,
  marginRatio: 1.15,
  marginPga: 1.35,
  calibrationSec: 180,
};

const GUATEMALA_PRIOR: NoisePrior = {
  ratioMult: 1.35,
  pgaMult: 1.8,
  marginRatio: 1.3,
  marginPga: 1.8,
  calibrationSec: 300,
};

const NETWORK_PRIORS: Record<string, NoisePrior> = {
  GI: GUATEMALA_PRIOR,
  GT: GUATEMALA_PRIOR,
};

// Estaciones de Guatemala que llegan con otro código de red (TC, HN)
const GUATEMALA_STATION_CODES = new Set(['EGUA', 'LPAZ', 'ICC1', 'BDG']);

const PGA_LOG_MIN = -4; // 1e-4 gal
const PGA_LOG_STEP = 0.04;
const PGA_BINS = 175; // hasta 1e3 gal
const RATIO_LOG_MIN = -1; // 0.1
const RATIO_LOG_STEP = 0.02;
const RATIO_BINS = 200; // hasta 1e3

const HALF_LIFE_SEC = 12 * 3600;
const DECAY_BATCH_SEC = 10;
const LEARN_REFRESH_SEC = 10;
const FULL_CONFIDENCE_SEC = 1800;
const HIGH_QUANTILE = 0.995;
const EXTREME_PEAK_FACTOR = 25; // picos > 25 * P99.5 no se aprenden (evento real o glitch)

const MAX_RATIO_THRESHOLD = 14;
const MAX_MIN_PGA_GAL = 1.2;
const STRONG_MOTION_MIN_GAL = 2.0;
const STRONG_MOTION_FACTOR = 6;

const FALSE_TRIGGER_PENALTY = 0.35;
const STUCK_TRIGGER_PENALTY = 0.7;
const CORROBORATED_RELIEF = 0.6;
const MAX_PENALTY = 4;
const PENALTY_HALF_LIFE_MS = 3 * 3600_000;
const QUARANTINE_PENALTY = 3.0;
const QUARANTINE_FALSE_COUNT = 6;
const QUARANTINE_WINDOW_MS = 30 * 60_000;
const QUARANTINE_DURATION_MS = 20 * 60_000;
const FALSE_TRIGGER_HISTORY_MS = 24 * 3600_000;

const SAVE_INTERVAL_MS = 5 * 60_000;
const PROFILE_VERSION = 1;

class LogHistogram {
  readonly counts: Float64Array;
  total = 0;

  constructor(
    private readonly minLog: number,
    private readonly step: number,
    readonly bins: number
  ) {
    this.counts = new Float64Array(bins);
  }

  add(value: number, weight: number): void {
    if (!(weight > 0) || !Number.isFinite(value)) return;
    const logValue = Math.log10(Math.max(value, 1e-12));
    let idx = Math.floor((logValue - this.minLog) / this.step);
    if (idx < 0) idx = 0;
    else if (idx >= this.bins) idx = this.bins - 1;
    this.counts[idx] += weight;
    this.total += weight;
  }

  scale(factor: number): void {
    for (let i = 0; i < this.bins; i++) this.counts[i] *= factor;
    this.total *= factor;
  }

  quantile(q: number): number {
    if (this.total <= 0) return 0;
    const target = q * this.total;
    let acc = 0;
    for (let i = 0; i < this.bins; i++) {
      const c = this.counts[i];
      if (c > 0 && acc + c >= target) {
        return Math.pow(10, this.minLog + (i + (target - acc) / c) * this.step);
      }
      acc += c;
    }
    return Math.pow(10, this.minLog + this.bins * this.step);
  }

  serialize(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < this.bins; i++) {
      if (this.counts[i] > 0.001) out.push([i, Math.round(this.counts[i] * 1000) / 1000]);
    }
    return out;
  }

  load(pairs: unknown): void {
    this.counts.fill(0);
    this.total = 0;
    if (!Array.isArray(pairs)) return;
    for (const pair of pairs) {
      if (!Array.isArray(pair)) continue;
      const idx = Number(pair[0]);
      const count = Number(pair[1]);
      if (Number.isInteger(idx) && idx >= 0 && idx < this.bins && Number.isFinite(count) && count > 0) {
        this.counts[idx] = count;
        this.total += count;
      }
    }
  }
}

interface LearnedStats {
  medianPga: number;
  highPga: number;
  medianRatio: number;
  highRatio: number;
  atObservedSec: number;
}

interface StreamNoise {
  key: string;
  network: string;
  station: string;
  channel: string;
  pga: LogHistogram;
  ratio: LogHistogram;
  observedSec: number;
  decayCarrySec: number;
  penalty: number;
  penaltyAtMs: number;
  falseTriggers: number[];
  quarantineUntilMs: number;
  wasQuarantined: boolean;
  learned: LearnedStats | null;
  last: NoiseThresholds | null;
}

export class NoiseCalibrator {
  private static instance: NoiseCalibrator | null = null;

  private readonly streams: Map<string, StreamNoise> = new Map();
  private readonly persist: boolean;
  private readonly filePath: string;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(options?: { persist?: boolean; filePath?: string }) {
    this.persist = options?.persist ?? true;
    this.filePath = options?.filePath ?? path.join(process.cwd(), 'data', 'noise-profiles.json');
    if (this.persist) {
      this.loadFromDisk();
      this.saveTimer = setInterval(() => this.flush(), SAVE_INTERVAL_MS);
      this.saveTimer.unref();
    }
  }

  public static getInstance(): NoiseCalibrator {
    if (!NoiseCalibrator.instance) {
      NoiseCalibrator.instance = new NoiseCalibrator();
    }
    return NoiseCalibrator.instance;
  }

  public static streamKey(network: string, station: string, channel: string): string {
    return `${(network || '').toUpperCase()}.${(station || '').toUpperCase()}.${(channel || '').toUpperCase()}`;
  }

  /**
   * Registra el ruido observado en un paquete. Los paquetes que inician con la estación disparada
   * no se aprenden; los picos extremos tampoco una vez que el canal está calibrado.
   */
  public observe(key: string, ctx: NoiseStreamContext, obs: NoiseObservation): void {
    if (!(obs.durationSec > 0)) return;
    const s = this.getOrCreate(key, ctx);

    s.decayCarrySec += obs.durationSec;
    if (s.decayCarrySec >= DECAY_BATCH_SEC) {
      const factor = Math.pow(0.5, s.decayCarrySec / HALF_LIFE_SEC);
      s.pga.scale(factor);
      s.ratio.scale(factor);
      s.decayCarrySec = 0;
    }

    if (obs.duringTrigger) return;

    const learned = s.learned;
    if (learned && s.observedSec >= this.priorFor(ctx).calibrationSec &&
        obs.peakPga > EXTREME_PEAK_FACTOR * Math.max(learned.highPga, 1e-3)) {
      return;
    }

    const weight = Math.min(30, obs.durationSec);
    s.pga.add(obs.peakPga, weight);
    if (obs.peakRatio > 0) s.ratio.add(obs.peakRatio, weight);
    s.observedSec += obs.durationSec;
    this.dirty = true;
  }

  /**
   * Umbrales efectivos de un canal: max(base, ruido aprendido * margen) con penalización y cuarentena.
   */
  public getThresholds(
    key: string,
    ctx: NoiseStreamContext,
    base: NoiseBaseThresholds,
    nowMs: number = Date.now()
  ): NoiseThresholds {
    const s = this.getOrCreate(key, ctx);
    const prior = this.priorFor(ctx);
    const learned = this.getLearned(s);
    const ready = learned !== null && s.observedSec >= prior.calibrationSec;
    const penalty = this.currentPenalty(s, nowMs);
    const quarantined = nowMs < s.quarantineUntilMs;

    if (s.wasQuarantined && !quarantined) {
      s.wasQuarantined = false;
      console.log(`[NoiseCal] ${key} sale de cuarentena (penalización ${penalty.toFixed(2)}).`);
    }

    let ratioThreshold = base.ratio * prior.ratioMult;
    let minPgaGal = base.minPgaGal * prior.pgaMult;

    if (ready && learned) {
      const confidence = Math.min(1, s.observedSec / FULL_CONFIDENCE_SEC);
      const widen = 1 + 0.5 * (1 - confidence);
      ratioThreshold = Math.max(base.ratio, learned.highRatio * prior.marginRatio * widen);
      minPgaGal = Math.max(base.minPgaGal, learned.highPga * prior.marginPga * widen);
    }

    ratioThreshold *= 1 + 0.3 * penalty;
    minPgaGal *= 1 + 0.6 * penalty;
    ratioThreshold = Math.min(ratioThreshold, Math.max(MAX_RATIO_THRESHOLD, base.ratio));
    minPgaGal = Math.min(minPgaGal, Math.max(MAX_MIN_PGA_GAL, base.minPgaGal));

    const highPga = learned?.highPga ?? 0;
    const severity = Math.max(minPgaGal / base.minPgaGal, ratioThreshold / base.ratio);
    let noiseClass: NoiseClass;
    if (quarantined) noiseClass = 'QUARANTINED';
    else if (!ready) noiseClass = 'CALIBRATING';
    else if (severity <= 1.05) noiseClass = 'QUIET';
    else if (severity <= 1.6) noiseClass = 'NORMAL';
    else if (severity <= 3) noiseClass = 'NOISY';
    else noiseClass = 'VERY_NOISY';

    const result: NoiseThresholds = {
      ready,
      noiseClass,
      ratioThreshold,
      minPgaGal,
      strongMotionGal: Math.max(STRONG_MOTION_MIN_GAL, STRONG_MOTION_FACTOR * highPga),
      quarantined,
      penalty,
      medianPga: learned?.medianPga ?? 0,
      highPga,
    };
    s.last = result;
    return result;
  }

  public isQuarantined(key: string, nowMs: number = Date.now()): boolean {
    const s = this.streams.get(key);
    return !!s && nowMs < s.quarantineUntilMs;
  }

  /** Un disparo expiró sin que ninguna red de estaciones lo corroborara. */
  public reportFalseTrigger(key: string, nowMs: number = Date.now()): void {
    const s = this.streams.get(key);
    if (!s) return;
    this.addPenalty(s, FALSE_TRIGGER_PENALTY, nowMs);
    s.falseTriggers.push(nowMs);
    const horizon = nowMs - FALSE_TRIGGER_HISTORY_MS;
    s.falseTriggers = s.falseTriggers.filter((t) => t >= horizon).slice(-100);
    this.evaluateQuarantine(s, nowMs);
  }

  /** El DSP tuvo que forzar la liberación de un disparo sostenido (tremor, ruido continuo). */
  public reportStuckTrigger(key: string, nowMs: number = Date.now()): void {
    const s = this.streams.get(key);
    if (!s) return;
    this.addPenalty(s, STUCK_TRIGGER_PENALTY, nowMs);
    this.evaluateQuarantine(s, nowMs);
  }

  /** El disparo formó parte de un sismo confirmado: el canal es confiable. */
  public reportCorroboratedTrigger(key: string, nowMs: number = Date.now()): void {
    const s = this.streams.get(key);
    if (!s) return;
    s.penalty = Math.max(0, this.currentPenalty(s, nowMs) - CORROBORATED_RELIEF);
    s.penaltyAtMs = nowMs;
    s.quarantineUntilMs = 0;
    this.dirty = true;
  }

  /** Borra el perfil de una estación (todos sus canales) para recalibrar desde cero. */
  public resetStation(station: string): number {
    const code = (station || '').trim().toUpperCase();
    let removed = 0;
    for (const [key, s] of this.streams) {
      if (s.station === code) {
        this.streams.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }

  public getSnapshot(nowMs: number = Date.now()): NoiseStreamSnapshot[] {
    const out: NoiseStreamSnapshot[] = [];
    for (const s of this.streams.values()) {
      const learned = this.getLearned(s);
      const last = s.last;
      const quarantined = nowMs < s.quarantineUntilMs;
      out.push({
        key: s.key,
        network: s.network,
        station: s.station,
        channel: s.channel,
        noiseClass: quarantined ? 'QUARANTINED' : (last?.noiseClass ?? 'CALIBRATING'),
        ready: last?.ready ?? false,
        observedMin: Number((s.observedSec / 60).toFixed(1)),
        medianPgaGal: Number((learned?.medianPga ?? 0).toFixed(5)),
        highPgaGal: Number((learned?.highPga ?? 0).toFixed(5)),
        medianRatio: Number((learned?.medianRatio ?? 0).toFixed(2)),
        highRatio: Number((learned?.highRatio ?? 0).toFixed(2)),
        ratioThreshold: last ? Number(last.ratioThreshold.toFixed(2)) : null,
        minPgaGal: last ? Number(last.minPgaGal.toFixed(4)) : null,
        penalty: Number(this.currentPenalty(s, nowMs).toFixed(2)),
        quarantined,
        quarantineLeftMin: quarantined ? Number(((s.quarantineUntilMs - nowMs) / 60000).toFixed(1)) : 0,
        falseTriggersLastHour: s.falseTriggers.filter((t) => nowMs - t <= 3600_000).length,
      });
    }
    return out.sort((a, b) => a.station.localeCompare(b.station) || a.channel.localeCompare(b.channel));
  }

  /** Guarda los perfiles en disco de forma atómica (también se invoca al apagar el servidor). */
  public flush(): void {
    if (!this.persist || !this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const streams: Record<string, unknown> = {};
      for (const [key, s] of this.streams) {
        if (s.observedSec < 30 && s.penalty <= 0) continue;
        streams[key] = {
          network: s.network,
          station: s.station,
          channel: s.channel,
          observedSec: Math.round(s.observedSec),
          penalty: Number(s.penalty.toFixed(3)),
          penaltyAtMs: s.penaltyAtMs,
          falseTriggers: s.falseTriggers,
          quarantineUntilMs: s.quarantineUntilMs,
          pga: s.pga.serialize(),
          ratio: s.ratio.serialize(),
        };
      }

      const tmpFile = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify({ version: PROFILE_VERSION, savedAt: new Date().toISOString(), streams }), 'utf8');
      fs.renameSync(tmpFile, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.warn('[NoiseCal] No se pudo guardar data/noise-profiles.json:', (err as Error).message);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== PROFILE_VERSION || typeof parsed.streams !== 'object') return;

      for (const [key, raw] of Object.entries<any>(parsed.streams)) {
        if (!raw || typeof raw.station !== 'string') continue;
        const s = this.getOrCreate(key, {
          network: String(raw.network || ''),
          station: raw.station,
          channel: String(raw.channel || ''),
        });
        s.pga.load(raw.pga);
        s.ratio.load(raw.ratio);
        s.observedSec = Number.isFinite(raw.observedSec) ? Number(raw.observedSec) : 0;
        s.penalty = Number.isFinite(raw.penalty) ? Number(raw.penalty) : 0;
        s.penaltyAtMs = Number.isFinite(raw.penaltyAtMs) ? Number(raw.penaltyAtMs) : 0;
        s.falseTriggers = Array.isArray(raw.falseTriggers) ? raw.falseTriggers.filter((t: unknown) => Number.isFinite(t)) : [];
        s.quarantineUntilMs = Number.isFinite(raw.quarantineUntilMs) ? Number(raw.quarantineUntilMs) : 0;
        s.wasQuarantined = Date.now() < s.quarantineUntilMs;
      }
      console.log(`[NoiseCal] ${this.streams.size} perfiles de ruido cargados desde ${this.filePath}`);
    } catch (err) {
      console.warn('[NoiseCal] Perfil de ruido ilegible, se recalibra desde cero:', (err as Error).message);
      this.streams.clear();
    }
  }

  private getOrCreate(key: string, ctx: NoiseStreamContext): StreamNoise {
    let s = this.streams.get(key);
    if (!s) {
      s = {
        key,
        network: (ctx.network || '').toUpperCase(),
        station: (ctx.station || '').toUpperCase(),
        channel: (ctx.channel || '').toUpperCase(),
        pga: new LogHistogram(PGA_LOG_MIN, PGA_LOG_STEP, PGA_BINS),
        ratio: new LogHistogram(RATIO_LOG_MIN, RATIO_LOG_STEP, RATIO_BINS),
        observedSec: 0,
        decayCarrySec: 0,
        penalty: 0,
        penaltyAtMs: 0,
        falseTriggers: [],
        quarantineUntilMs: 0,
        wasQuarantined: false,
        learned: null,
        last: null,
      };
      this.streams.set(key, s);
    }
    return s;
  }

  private priorFor(ctx: NoiseStreamContext): NoisePrior {
    const station = (ctx.station || '').toUpperCase();
    if (GUATEMALA_STATION_CODES.has(station)) return GUATEMALA_PRIOR;
    return NETWORK_PRIORS[(ctx.network || '').toUpperCase()] ?? DEFAULT_PRIOR;
  }

  private getLearned(s: StreamNoise): LearnedStats | null {
    if (s.pga.total <= 0) return null;
    if (s.learned && s.observedSec - s.learned.atObservedSec < LEARN_REFRESH_SEC) return s.learned;
    s.learned = {
      medianPga: s.pga.quantile(0.5),
      highPga: s.pga.quantile(HIGH_QUANTILE),
      medianRatio: s.ratio.quantile(0.5),
      highRatio: s.ratio.quantile(HIGH_QUANTILE),
      atObservedSec: s.observedSec,
    };
    return s.learned;
  }

  private currentPenalty(s: StreamNoise, nowMs: number): number {
    if (s.penalty <= 0) return 0;
    const elapsed = Math.max(0, nowMs - s.penaltyAtMs);
    return s.penalty * Math.pow(0.5, elapsed / PENALTY_HALF_LIFE_MS);
  }

  private addPenalty(s: StreamNoise, amount: number, nowMs: number): void {
    s.penalty = Math.min(MAX_PENALTY, this.currentPenalty(s, nowMs) + amount);
    s.penaltyAtMs = nowMs;
    this.dirty = true;
  }

  private evaluateQuarantine(s: StreamNoise, nowMs: number): void {
    const recent = s.falseTriggers.filter((t) => nowMs - t <= QUARANTINE_WINDOW_MS).length;
    if (s.penalty < QUARANTINE_PENALTY && recent < QUARANTINE_FALSE_COUNT) return;
    const alreadyQuarantined = nowMs < s.quarantineUntilMs;
    s.quarantineUntilMs = nowMs + QUARANTINE_DURATION_MS;
    s.wasQuarantined = true;
    if (!alreadyQuarantined) {
      console.warn(`[NoiseCal] ${s.key} en cuarentena ${QUARANTINE_DURATION_MS / 60000} min: penalización ${s.penalty.toFixed(2)}, ${recent} disparos sin corroborar en 30 min.`);
    }
  }
}
