/**
 * FILTROS IIR BUTTERWORTH PASA-BANDA (SECCIONES BIQUAD)
 *
 * Diseño analítico por transformación bilineal con pre-distorsión de frecuencias, equivalente a
 * `scipy.signal.butter(order, [f1, f2], 'bandpass', output='sos')`. Se usa en el análisis de eventos por
 * estación (arquitectura GlobalQuake: Butterworth de orden 3 en 2 - 5 Hz).
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface Complex {
  re: number;
  im: number;
}

function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function cSqrt(a: Complex): Complex {
  const mag = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (mag + a.re) / 2));
  const im = Math.sqrt(Math.max(0, (mag - a.re) / 2));
  return { re, im: a.im < 0 ? -im : im };
}

/** Respuesta en magnitud de una sección biquad a la frecuencia angular digital `w` (rad/muestra) */
export function biquadMagnitude(section: Biquad, w: number): number {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = section.b0 + section.b1 * c1 + section.b2 * c2;
  const numIm = -(section.b1 * s1 + section.b2 * s2);
  const denRe = 1 + section.a1 * c1 + section.a2 * c2;
  const denIm = -(section.a1 * s1 + section.a2 * s2);
  return Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
}

/**
 * Filtro Butterworth pasa-banda digital. `order` es el orden del prototipo pasa-bajas: el pasa-banda resultante
 * tiene 2·order polos (order secciones biquad). La ganancia es unitaria en la frecuencia central.
 */
export function designButterworthBandpass(order: number, sampleRate: number, lowHz: number, highHz: number): Biquad[] {
  if (!(order >= 1) || !Number.isInteger(order)) throw new Error('El orden del filtro debe ser un entero positivo');
  if (!(sampleRate > 0)) throw new Error('La frecuencia de muestreo debe ser positiva');
  const nyquist = sampleRate / 2;
  const f2 = Math.min(highHz, nyquist * 0.98);
  const f1 = Math.min(lowHz, f2 * 0.9);
  if (!(f1 > 0) || !(f2 > f1)) throw new Error('Banda de frecuencias inválida');

  // Frecuencias analógicas pre-distorsionadas para que la bilineal conserve las esquinas de la banda
  const w1 = 2 * sampleRate * Math.tan((Math.PI * f1) / sampleRate);
  const w2 = 2 * sampleRate * Math.tan((Math.PI * f2) / sampleRate);
  const bandwidth = w2 - w1;
  const w0sq = w1 * w2;
  const k = 2 * sampleRate;

  // Polos del prototipo pasa-bajas (semiplano izquierdo). Solo se recorren los del semiplano superior
  // y el real único cuando el orden es impar: el conjugado de cada polo se incorpora al formar el biquad.
  const prototypePoles: Complex[] = [];
  for (let i = 0; i < order; i++) {
    const theta = (Math.PI * (2 * i + order + 1)) / (2 * order);
    const pole = { re: Math.cos(theta), im: Math.sin(theta) };
    if (pole.im > -1e-12) prototypePoles.push(pole);
  }

  const analogPolePairs: Complex[] = [];
  for (const p of prototypePoles) {
    // s² − B·p·s + w0² = 0  →  s = (B·p ± sqrt((B·p)² − 4·w0²)) / 2
    const bp = { re: bandwidth * p.re, im: bandwidth * p.im };
    const disc = cSqrt({ re: bp.re * bp.re - bp.im * bp.im - 4 * w0sq, im: 2 * bp.re * bp.im });
    const s1 = { re: (bp.re + disc.re) / 2, im: (bp.im + disc.im) / 2 };
    analogPolePairs.push(s1);
    if (Math.abs(p.im) > 1e-12) {
      const s2 = { re: (bp.re - disc.re) / 2, im: (bp.im - disc.im) / 2 };
      analogPolePairs.push(s2);
    }
  }

  const centerAnalog = Math.sqrt(w0sq);
  const centerDigital = 2 * Math.atan(centerAnalog / k);
  const sections: Biquad[] = [];
  for (const s of analogPolePairs) {
    // z = (k + s) / (k − s)
    const z = cDiv({ re: k + s.re, im: s.im }, { re: k - s.re, im: -s.im });
    const section: Biquad = { b0: 1, b1: 0, b2: -1, a1: -2 * z.re, a2: z.re * z.re + z.im * z.im };
    const gain = biquadMagnitude(section, centerDigital);
    const norm = gain > 0 ? 1 / gain : 1;
    sections.push({ b0: section.b0 * norm, b1: 0, b2: -section.b0 * norm, a1: section.a1, a2: section.a2 });
  }
  return sections;
}

/** Cascada de biquads en forma directa II transpuesta con estado persistente entre muestras */
export class SosFilter {
  private readonly z1: Float64Array;
  private readonly z2: Float64Array;

  constructor(private readonly sections: Biquad[]) {
    this.z1 = new Float64Array(sections.length);
    this.z2 = new Float64Array(sections.length);
  }

  public process(x: number): number {
    let v = x;
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i];
      const y = s.b0 * v + this.z1[i];
      this.z1[i] = s.b1 * v - s.a1 * y + this.z2[i];
      this.z2[i] = s.b2 * v - s.a2 * y;
      v = y;
    }
    return v;
  }

  public reset(): void {
    this.z1.fill(0);
    this.z2.fill(0);
  }
}
