/**
 * ANÁLISIS DE EVENTOS POR ESTACIÓN (ARQUITECTURA GLOBALQUAKE: BetterAnalysis + Event)
 *
 * Cada flujo vertical se filtra con un Butterworth pasa-banda (2 - 5 Hz, orden 3) y se promedia el valor
 * absoluto en cuatro escalas de tiempo (corta 0.5 s, media 6 s, tercera 30 s y larga adaptativa 200 s,
 * que se congela mientras el cociente corto/largo supera 4). Un evento nace cuando el cociente corto/largo
 * se mantiene sobre el umbral (ver `shouldStart`) y termina cuando la señal decae. El tiempo de llegada P no es
 * el cruce del umbral: se busca hacia atrás en el búfer previo hasta el último instante en que el cociente
 * estaba todavía en el nivel de fondo (`findPWave`). Los eventos son la entrada del agrupamiento
 * (`gq-cluster.ts`) y de la búsqueda de hipocentro (`gq-hypocenter.ts`).
 */

import { SosFilter, designButterworthBandpass } from './iir.js';

export type GqAnalysisStatus = 'INIT' | 'IDLE' | 'EVENT';

export interface GqAnalysisParams {
  /** Cociente corto/largo base. Un evento exige 1.3x durante 200 ms o 2.05x durante 100 ms */
  eventThreshold: number;
  minFreqHz: number;
  maxFreqHz: number;
  filterOrder: number;
  /** Hueco entre paquetes a partir del cual se reinicia el filtro (ms) */
  gapToleranceMs: number;
  /** Hueco máximo (ms) que conserva los promedios de fondo; uno mayor reinicia todo el análisis */
  softGapLimitMs: number;
  initOffsetMs: number;
  initAverageMs: number;
  /** Datos previos mínimos (s) para fijar la llegada P de un evento nuevo */
  minPreEventSec: number;
  eventEndSec: number;
  eventExtensionSec: number;
  eventTooLongSec: number;
  eventStoreSec: number;
  /** Frecuencia máxima (Hz) con la que se almacenan las características para buscar la llegada P */
  logRateHz: number;
}

export const GQ_DEFAULT_PARAMS: GqAnalysisParams = {
  eventThreshold: 4.75,
  minFreqHz: 2.0,
  maxFreqHz: 5.0,
  filterOrder: 3,
  gapToleranceMs: 1500,
  softGapLimitMs: 60_000,
  initOffsetMs: 4000,
  initAverageMs: 10_000,
  minPreEventSec: 30,
  eventEndSec: 7.0,
  eventExtensionSec: 90,
  eventTooLongSec: 5 * 60,
  eventStoreSec: 20 * 60,
  logRateHz: 20,
};

// Umbrales de cociente máximo con los que se recalcula la llegada P (más fuerte = más preciso)
const RECALCULATE_P_WAVE_THRESHOLDS = [16.0, 32.0, 64.0, 128.0, 512.0, 2048.0];
const SPECIAL_PERCENTILE = [0.08, 0.12, 0.18, 0.24, 0.32, 0.40, 0.48];
const SLOW_THRESHOLD_MULTIPLIERS = [1.12, 1.5, 1.9, 2.2, 2.4, 2.5, 2.6];
// Dos eventos de una misma estación con llegada P a menos de 3 s son el mismo: se descarta el posterior
const MIN_EVENT_DIFF_MS = 3000;
// Piso del promedio largo (cuentas): evita cocientes infinitos en canales planos
const MIN_LONG_AVERAGE = 0.05;

let nextEventId = 1;

/** Búfer circular con las características por muestra que necesita la búsqueda de la llegada P */
class FeatureRing {
  private readonly times: Float64Array;
  private readonly ratio: Float32Array;
  private readonly mediumRatio: Float32Array;
  private readonly specialRatio: Float32Array;
  private head = 0;
  public size = 0;

  constructor(private readonly capacity: number) {
    this.times = new Float64Array(capacity);
    this.ratio = new Float32Array(capacity);
    this.mediumRatio = new Float32Array(capacity);
    this.specialRatio = new Float32Array(capacity);
  }

  public push(timeMs: number, ratio: number, mediumRatio: number, specialRatio: number): void {
    this.times[this.head] = timeMs;
    this.ratio[this.head] = ratio;
    this.mediumRatio[this.head] = mediumRatio;
    this.specialRatio[this.head] = specialRatio;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  public clear(): void {
    this.head = 0;
    this.size = 0;
  }

  private slot(chronoIndex: number): number {
    return (this.head - this.size + chronoIndex + this.capacity * 2) % this.capacity;
  }

  public timeAt(chronoIndex: number): number {
    return this.times[this.slot(chronoIndex)];
  }

  public ratioAt(chronoIndex: number): number {
    return this.ratio[this.slot(chronoIndex)];
  }

  public mediumRatioAt(chronoIndex: number): number {
    return this.mediumRatio[this.slot(chronoIndex)];
  }

  public specialRatioAt(chronoIndex: number): number {
    return this.specialRatio[this.slot(chronoIndex)];
  }

  public oldestTime(): number {
    return this.size > 0 ? this.timeAt(0) : 0;
  }

  /** Índice cronológico de la última muestra con tiempo <= timeMs (-1 si todas son posteriores) */
  public lastIndexAtOrBefore(timeMs: number): number {
    let lo = 0;
    let hi = this.size - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= timeMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Índice cronológico de la primera muestra con tiempo >= timeMs (size si todas son anteriores) */
  public firstIndexAtOrAfter(timeMs: number): number {
    let lo = 0;
    let hi = this.size - 1;
    let found = this.size;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) >= timeMs) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return found;
  }
}

export class GqStationEvent {
  public readonly id = nextEventId++;
  /** Instante en que se cruzó el umbral */
  public readonly startMs: number;
  public endMs = 0;
  /** Llegada P estimada (ms); 0 mientras no hay suficientes datos previos y -1 si no se encontró */
  public pWaveMs = 0;
  public maxRatio = 0;
  /** Valor absoluto máximo del registro filtrado (cuentas) */
  public maxFilteredCounts = 0;
  public valid = true;
  public isSWave = false;
  public updatesCount = 1;
  /** Identificador del grupo (cluster) al que pertenece, o null */
  public clusterId: number | null = null;
  private nextPWaveCalc = -1;
  private readonly firstLogMs: number;

  constructor(
    public readonly analysis: GqStationAnalysis,
    startMs: number,
    firstLogMs: number
  ) {
    this.startMs = startMs;
    this.firstLogMs = firstLogMs;
  }

  public hasEnded(): boolean {
    return this.endMs !== 0;
  }

  public end(timeMs: number): void {
    this.endMs = timeMs;
    this.updatesCount++;
  }

  public endBadly(): void {
    this.valid = false;
  }

  public setPWave(pWaveMs: number): void {
    if (this.pWaveMs !== pWaveMs) this.updatesCount++;
    this.pWaveMs = pWaveMs;
    for (const other of this.analysis.events) {
      if (other === this) continue;
      if (Math.abs(this.pWaveMs - other.pWaveMs) < MIN_EVENT_DIFF_MS) {
        const bad = this.startMs > other.startMs ? this : other;
        bad.valid = false;
      }
    }
  }

  /** Registra una muestra del evento: actualiza el cociente máximo y recalcula la llegada P cuando la señal se refuerza */
  public log(ratio: number, absFiltered: number): void {
    if (ratio > this.maxRatio) this.maxRatio = ratio;
    if (absFiltered > this.maxFilteredCounts) this.maxFilteredCounts = absFiltered;

    const eligible = this.startMs - this.firstLogMs >= this.analysis.params.minPreEventSec * 1000;
    if (!eligible || this.nextPWaveCalc > RECALCULATE_P_WAVE_THRESHOLDS.length - 1) return;
    const threshold = this.nextPWaveCalc < 0 ? -1 : RECALCULATE_P_WAVE_THRESHOLDS[this.nextPWaveCalc];
    if (this.maxRatio >= threshold) {
      this.nextPWaveCalc++;
      this.findPWave(this.analysis.ring);
    }
  }

  /**
   * Llegada P: se retrocede desde el cruce del umbral hasta el último instante en que el cociente corto/largo
   * y el promedio especial seguían en el nivel de fondo (percentil bajo del cociente medio de la ventana previa).
   * Cuanto más fuerte el evento, más corta la ventana previa y más estricto el criterio.
   */
  private findPWave(ring: FeatureRing): void {
    const level = this.nextPWaveCalc;
    if (ring.size < 2 || level < 0 || level >= SPECIAL_PERCENTILE.length) return;

    const lookBackMs = level === 0 ? this.analysis.params.eventExtensionSec * 1000 : (60.0 / level) * 1000;
    const startIdx = ring.lastIndexAtOrBefore(this.startMs);
    if (startIdx < 0) return;
    const firstIdx = ring.firstIndexAtOrAfter(this.startMs - lookBackMs);
    if (firstIdx > startIdx) return;

    const slows: number[] = [];
    let maxSpecial = -Number.MAX_VALUE;
    let minSpecial = Number.MAX_VALUE;
    for (let i = firstIdx; i <= startIdx; i++) {
      slows.push(ring.mediumRatioAt(i));
      const special = ring.specialRatioAt(i);
      if (special > 0) {
        if (special > maxSpecial) maxSpecial = special;
        if (special < minSpecial) minSpecial = special;
      }
    }
    if (slows.length === 0 || minSpecial === Number.MAX_VALUE) return;

    maxSpecial = Math.max(minSpecial * 5.0, maxSpecial);
    slows.sort((a, b) => a - b);
    const slow15Pct = slows[Math.floor((slows.length - 1) * 0.175)];
    const mul = SPECIAL_PERCENTILE[level] * 1.1;
    const specialThreshold = maxSpecial * mul + (1 - mul) * minSpecial;
    const slowLimit = slow15Pct * (SLOW_THRESHOLD_MULTIPLIERS[level] * 1.25);

    let pWave = -1;
    for (let i = startIdx; i >= firstIdx; i--) {
      if (ring.ratioAt(i) <= slowLimit && ring.specialRatioAt(i) <= specialThreshold) {
        pWave = ring.timeAt(i);
        break;
      }
    }
    this.setPWave(pWave);
  }
}

export class GqStationAnalysis {
  public readonly params: GqAnalysisParams;
  public readonly events: GqStationEvent[] = [];
  public status: GqAnalysisStatus = 'INIT';
  public sampleRate = 0;
  public ring!: FeatureRing;

  private filter: SosFilter | null = null;
  private initProgress = 0;
  private initialOffsetSum = 0;
  private initialOffsetCnt = 0;
  private initialRatioSum = 0;
  private initialRatioCnt = 0;
  private initialOffset = 0;
  private longAverage = 0;
  private mediumAverage = 0;
  private shortAverage = 0;
  private specialAverage = 0;
  private thirdAverage = 0;
  private eventTimer = 0;
  private latestLogMs = 0;
  private lastEndMs = 0;
  private logDecimation = 1;
  private logCounter = 0;
  // Tras un hueco corto el filtro se reinicia y se esperan unas muestras antes de volver a disparar
  private settleUntilMs = 0;
  private lastRatio = 0;

  constructor(params: Partial<GqAnalysisParams> = {}) {
    this.params = { ...GQ_DEFAULT_PARAMS, ...params };
  }

  /** Último cociente corto/largo calculado (0 mientras el análisis inicializa) */
  public get currentRatio(): number {
    return this.lastRatio;
  }

  public get latestLogTimeMs(): number {
    return this.latestLogMs;
  }

  private configure(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.filter = new SosFilter(
      designButterworthBandpass(this.params.filterOrder, sampleRate, this.params.minFreqHz, this.params.maxFreqHz)
    );
    this.logDecimation = Math.max(1, Math.round(sampleRate / this.params.logRateHz));
    const capacity = Math.ceil(((this.params.eventExtensionSec + 40) * sampleRate) / this.logDecimation);
    this.ring = new FeatureRing(capacity);
  }

  /** Reinicio completo: vuelve a inicializar los promedios y termina mal los eventos en curso */
  public reset(): void {
    this.status = 'INIT';
    this.initProgress = 0;
    this.initialOffsetSum = 0;
    this.initialOffsetCnt = 0;
    this.initialRatioSum = 0;
    this.initialRatioCnt = 0;
    this.latestLogMs = 0;
    this.lastRatio = 0;
    this.settleUntilMs = 0;
    this.filter?.reset();
    this.ring?.clear();
    for (const event of this.events) {
      if (!event.hasEnded()) event.endBadly();
    }
  }

  /** Reinicio corto tras un hueco breve: se conservan los promedios de fondo y el búfer previo */
  private softReset(timeMs: number): void {
    this.filter?.reset();
    for (const event of this.events) {
      if (!event.hasEnded()) event.endBadly();
    }
    if (this.status === 'EVENT') this.status = 'IDLE';
    this.settleUntilMs = timeMs + 4000;
  }

  /**
   * Procesa un paquete contiguo de muestras. `startMs` es el instante de la primera muestra.
   * Los paquetes no contiguos reinician el filtro; los huecos largos reinician todo el análisis.
   */
  public analyse(samples: ArrayLike<number>, startMs: number, sampleRate: number): void {
    if (!(sampleRate > 0) || samples.length === 0 || !Number.isFinite(startMs)) return;
    if (!this.filter || Math.abs(sampleRate - this.sampleRate) > 0.2) {
      this.configure(sampleRate);
      this.reset();
      this.lastEndMs = 0;
    }

    const dtMs = 1000 / sampleRate;
    if (this.lastEndMs > 0) {
      const gapMs = startMs - this.lastEndMs;
      if (gapMs > this.params.gapToleranceMs) {
        if (gapMs > this.params.softGapLimitMs || this.status === 'INIT') this.reset();
        else this.softReset(startMs);
      }
    }

    for (let i = 0; i < samples.length; i++) {
      this.nextSample(samples[i], startMs + i * dtMs);
    }
    this.lastEndMs = startMs + samples.length * dtMs;
  }

  private nextSample(v: number, timeMs: number): void {
    if (!Number.isFinite(v) || !this.filter) return;
    if (timeMs <= this.latestLogMs) return;
    this.latestLogMs = timeMs;
    const sr = this.sampleRate;

    if (this.status === 'INIT') {
      this.initSample(v, sr);
      return;
    }

    const filtered = this.filter.process(v - this.initialOffset);
    // Transitorio posterior a un hueco: el filtro se asienta sin contaminar los promedios ni abrir eventos
    if (timeMs < this.settleUntilMs) {
      this.lastRatio = 1;
      return;
    }
    const abs = Math.abs(filtered);
    this.shortAverage -= (this.shortAverage - abs) / (sr * 0.5);
    this.mediumAverage -= (this.mediumAverage - abs) / (sr * 6.0);
    this.thirdAverage -= (this.thirdAverage - abs) / (sr * 30.0);
    if (abs > this.specialAverage) this.specialAverage = abs;
    else this.specialAverage -= (this.specialAverage - abs) / (sr * 40.0);

    if (this.shortAverage / Math.max(this.longAverage, MIN_LONG_AVERAGE) < 4.0) {
      this.longAverage -= (this.longAverage - abs) / (sr * 200.0);
    }
    const longAvg = Math.max(this.longAverage, MIN_LONG_AVERAGE);
    const ratio = this.shortAverage / longAvg;
    this.lastRatio = ratio;
    const threshold = this.params.eventThreshold;

    if (this.status === 'IDLE' && this.ring.size > 0) {
      const cond1 = ratio >= threshold * 1.3 && timeMs - this.eventTimer > 200;
      const cond2 = ratio >= threshold * 2.05 && timeMs - this.eventTimer > 100;
      const condMain = this.shortAverage / Math.max(this.thirdAverage, MIN_LONG_AVERAGE) > 3.0;
      if (condMain && (cond1 || cond2)) {
        this.status = 'EVENT';
        const firstLog = Math.max(this.ring.oldestTime(), timeMs - this.params.eventExtensionSec * 1000);
        this.events.unshift(new GqStationEvent(this, timeMs, firstLog));
      }
    }
    if (ratio < threshold) this.eventTimer = timeMs;

    const latest = this.events[0];
    if (this.status === 'EVENT' && latest) {
      const sinceStart = timeMs - latest.startMs;
      if (sinceStart >= this.params.eventEndSec * 1000 && this.mediumAverage < this.thirdAverage * 0.95) {
        this.status = 'IDLE';
        latest.end(timeMs);
      }
      if (sinceStart >= this.params.eventTooLongSec * 1000) {
        this.reset();
        return;
      }
      if (
        sinceStart >= 1000 &&
        ((sinceStart < 7500 && this.shortAverage < longAvg * 1.25) || this.shortAverage < this.mediumAverage * 0.12)
      ) {
        this.status = 'IDLE';
        latest.endBadly();
      }
    }

    // El búfer se alimenta antes que los eventos para que la búsqueda de la llegada P incluya la muestra actual
    if (++this.logCounter >= this.logDecimation) {
      this.logCounter = 0;
      this.ring.push(timeMs, this.shortAverage / longAvg, this.mediumAverage / longAvg, this.specialAverage / longAvg);
    }
    for (const event of this.events) {
      if (event.valid && (!event.hasEnded() || timeMs - event.endMs < this.params.eventExtensionSec * 1000)) {
        event.log(ratio, abs);
      }
    }
  }

  private initSample(v: number, sr: number): void {
    const filter = this.filter!;
    const offsetSamples = this.params.initOffsetMs * 0.001 * sr;
    const totalSamples = (this.params.initAverageMs + this.params.initOffsetMs) * 0.001 * sr;
    if (this.initProgress <= offsetSamples) {
      this.initialOffsetSum += v;
      this.initialOffsetCnt++;
      if (this.initProgress >= offsetSamples * 0.25) {
        const offset = this.initialOffsetSum / this.initialOffsetCnt;
        const filtered = filter.process(v - offset);
        this.initialRatioSum += Math.abs(filtered);
        this.initialRatioCnt++;
        this.longAverage = this.initialRatioSum / this.initialRatioCnt;
      }
    } else if (this.initProgress <= totalSamples) {
      const offset = this.initialOffsetSum / this.initialOffsetCnt;
      const filtered = filter.process(v - offset);
      this.longAverage -= (this.longAverage - Math.abs(filtered)) / (sr * 6.0);
    } else {
      this.initialOffset = this.initialOffsetSum / Math.max(1, this.initialOffsetCnt);
      this.longAverage = Math.max(this.longAverage, MIN_LONG_AVERAGE);
      this.shortAverage = this.longAverage;
      this.mediumAverage = this.longAverage;
      this.specialAverage = this.longAverage * 2.5;
      this.thirdAverage = this.longAverage;
      this.longAverage *= 0.75;
      this.status = 'IDLE';
      this.eventTimer = this.latestLogMs;
    }
    this.initProgress++;
  }

  /** Mantenimiento periódico: descarta eventos inválidos y los terminados hace más de `eventStoreSec` */
  public prune(nowMs: number): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (!event.valid) {
        this.events.splice(i, 1);
      } else if (event.hasEnded() && nowMs - event.endMs >= this.params.eventStoreSec * 1000) {
        this.events.splice(i, 1);
      }
    }
  }
}
