/**
 * REFINAMIENTO DEL TIEMPO DE LLEGADA P CON AIC (Maeda, 1985)
 *
 * El cruce del umbral STA/LTA depende del umbral y llega después del inicio real de la onda.
 * Dentro de una ventana alrededor del cruce, el AIC busca el punto donde la varianza pasa de ruido a señal.
 * El resultado solo se acepta si cae dentro de la ventana; si no, se conserva el cruce STA/LTA.
 */

const PRE_SEC = 6;
const POST_SEC = 1;
const MIN_WINDOW_SEC = 2;
const BUFFER_SEC = 30;
const CONTIGUITY_TOLERANCE_MS = 1500;
const MAX_LEAD_MS = 6000;
const MAX_LAG_MS = 500;
const MIN_VARIANCE = 1e-12;
// Un arribo P real eleva la desviación estándar varias veces; un mínimo del AIC sin escalón es ruido.
const MIN_STEP_RATIO = 2.0;

function segmentStd(values: ArrayLike<number>, a: number, b: number): number {
  const n = b - a;
  if (n <= 0) return 0;
  let mean = 0;
  for (let i = a; i < b; i++) mean += values[i];
  mean /= n;
  let ss = 0;
  for (let i = a; i < b; i++) ss += (values[i] - mean) ** 2;
  return Math.sqrt(ss / n);
}

export function aicOnsetIndex(values: ArrayLike<number>, i0: number, i1: number): number | null {
  const n = i1 - i0;
  if (n < 5) return null;

  let mean = 0;
  for (let i = i0; i < i1; i++) mean += values[i];
  mean /= n;

  const cum1 = new Float64Array(n + 1);
  const cum2 = new Float64Array(n + 1);
  for (let j = 0; j < n; j++) {
    const x = values[i0 + j] - mean;
    cum1[j + 1] = cum1[j] + x;
    cum2[j + 1] = cum2[j] + x * x;
  }

  const variance = (count: number, sum1: number, sum2: number): number =>
    Math.max(MIN_VARIANCE, (sum2 - (sum1 * sum1) / count) / count);

  let bestK = -1;
  let bestAic = Infinity;
  for (let k = 2; k <= n - 3; k++) {
    const nL = k;
    const nR = n - k;
    const aic =
      nL * Math.log(variance(nL, cum1[k], cum2[k])) +
      nR * Math.log(variance(nR, cum1[n] - cum1[k], cum2[n] - cum2[k]));
    if (aic < bestAic) {
      bestAic = aic;
      bestK = k;
    }
  }
  return bestK >= 0 ? i0 + bestK : null;
}

export class OnsetBuffer {
  private values: number[] = [];
  private startMs = 0;
  private sampleRate = 0;

  public append(startMs: number, sampleRate: number, samples: ArrayLike<number>): void {
    if (!(sampleRate > 0) || samples.length === 0) return;
    const endMs = this.endMs();
    const contiguous =
      this.values.length > 0 &&
      sampleRate === this.sampleRate &&
      Math.abs(startMs - endMs) <= CONTIGUITY_TOLERANCE_MS;
    if (!contiguous) {
      this.values = [];
      this.startMs = startMs;
      this.sampleRate = sampleRate;
    }
    for (let i = 0; i < samples.length; i++) this.values.push(samples[i]);

    const maxSamples = Math.round(BUFFER_SEC * sampleRate);
    if (this.values.length > maxSamples) {
      const drop = this.values.length - maxSamples;
      this.values.splice(0, drop);
      this.startMs += (drop * 1000) / sampleRate;
    }
  }

  public refineOnset(triggerMs: number): number | null {
    if (this.values.length === 0 || !(this.sampleRate > 0)) return null;
    const rate = this.sampleRate;
    const i0 = Math.max(0, Math.ceil(((triggerMs - PRE_SEC * 1000 - this.startMs) * rate) / 1000));
    const i1 = Math.min(this.values.length, Math.floor(((triggerMs + POST_SEC * 1000 - this.startMs) * rate) / 1000));
    if (i1 - i0 < MIN_WINDOW_SEC * rate) return null;

    const k = aicOnsetIndex(this.values, i0, i1);
    if (k === null) return null;
    if (segmentStd(this.values, k, i1) < MIN_STEP_RATIO * segmentStd(this.values, i0, k)) return null;
    const pickMs = this.startMs + (k * 1000) / rate;
    if (pickMs < triggerMs - MAX_LEAD_MS || pickMs > triggerMs + MAX_LAG_MS) return null;
    return pickMs;
  }

  private endMs(): number {
    return this.startMs + (this.values.length * 1000) / (this.sampleRate || 1);
  }
}
