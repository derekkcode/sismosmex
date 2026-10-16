/**
 * PROCESAMIENTO DIGITAL DE SEÑALES SÍSMICAS (DSP) & ANÁLISIS EN TIEMPO REAL
 * Inspirado en USGS Swarm (Waveform display, STA/LTA Triggering, PGA y Escala Mercalli)
 */

import { NoiseCalibrator, NoiseClass } from './noise-calibrator.js';

export interface StationChannelMeta {
  code: string;
  locationCode?: string;
  sampleRate?: number;
  sensitivity?: number; // Cuentas por unidad física (e.g., 628460000 para VELOCITY)
  inputType?: 'VELOCITY' | 'ACCELERATION' | string;
}

export interface StaLtaState {
  sta: number;
  lta: number;
  lastRatio: number;
  triggered: boolean;
  triggerTime?: string;
  totalSamples: number; // Muestras con filtros asentados que ya alimentaron el STA/LTA (guardia de calentamiento >= nLta)
  frozenSamples?: number; // Contador de muestras con LTA congelado (tope máximo 60s)
  triggerCandidateSamples?: number;
  triggerCandidateTimeMs?: number;
  postTriggerSamples?: number; // Muestras restantes de enfriamiento tras liberar un disparo: la coda no se aprende como ruido
}

export interface ProcessedPacketResult {
  station: string;
  network: string;
  channel: string;
  sampleRate: number;
  startTime: string;
  endTime: string;
  sampleCount: number;
  rawCounts: number[];
  accelerationGal: number[]; // Aceleración en gal (cm/s^2)
  pga: number; // Peak Ground Acceleration en gal
  pgaStr: string;
  amplitudePhysical: number; // Amplitud física pico en unidad métrica
  amplitudeUnit: string; // 'µm/s' | 'mm/s' | 'cm/s' | 'gal' | 'mm/s²'
  amplitudeStr: string; // Cadena amigable para la UI (ej. '14.2 µm/s', '0.85 mm/s')
  maxVelocityMps: number; // Velocidad pico en m/s
  woodAndersonDispMm: number; // Amplitud máxima sintética Wood-Anderson (mm)
  continuousMmi: number; // Intensidad continua Mercalli (Wald et al. 1999)
  intensityMMI: number; // Nivel Mercalli entero estimado (0 - 10)
  meanCount: number;
  rms: number;
  freqDominantHz: number; // Frecuencia dominante estimada (Hz)
  highFreqRatio: number; // Proporción de energía en banda sísmica 2 - 10 Hz (0.0 a 1.0)
  isPureFrequencySeismic: boolean; // True si la energía se concentra en 2 - 10 Hz (distintivo de sismo local)
  staLta: {
    sta: number;
    lta: number;
    ratio: number;
    peakRatio: number; // Pico de STA/LTA dentro del paquete
    thresholdRatio: number; // Umbral STA/LTA efectivo (calibrado por el ruido del canal)
    minPgaGal: number; // Piso de PGA efectivo para abrir un disparo (calibrado)
    triggered: boolean;
    triggerSampleIndex?: number | null;
    triggerTimeIso?: string | null;
  };
  noise: {
    noiseClass: NoiseClass;
    ready: boolean;
    quarantined: boolean;
    penalty: number;
    medianPga: number; // gal, mediana del pico por paquete en reposo
    highPga: number; // gal, cuantil 99.5 % del ruido
    spikesRemoved: number; // muestras aisladas (agujas) reemplazadas en el paquete
  };
}

export interface StreamDspState {
  dc: number;             // Estimador continuo de componente continua (DC)
  prevRaw: number;        // Muestra anterior sin procesar para filtro paso-altas de DC
  prevHp: number;         // Salida anterior del filtro paso-altas de DC
  prevVelocity: number;   // Velocidad al final del paquete anterior (m/s)
  prevAccel: number;      // Aceleración al final del paquete anterior (gal)
  lastEndTimeMs: number;  // Marca de tiempo final del paquete anterior (ms)
  hasWarmStart: boolean;  // True si el filtro ya completó su arranque en caliente
  warmupSamples: number;  // Contador de muestras para calentamiento y estabilización de filtros
  // Filtro Butterworth pasabanda orden 4 (2 biquads en cascada) 1.0 - 10.0 Hz
  // Biquad 1
  bp1_x1: number;
  bp1_x2: number;
  bp1_y1: number;
  bp1_y2: number;
  // Biquad 2
  bp2_x1: number;
  bp2_x2: number;
  bp2_y1: number;
  bp2_y2: number;
  // Filtro sintético Wood-Anderson (T0=0.8s, h=0.8, V=2080)
  waX1: number;
  waX2: number;
  waY1: number;
  waY2: number;
  prevCfInput: number;    // Función característica (entrada) de la muestra previa; NaN si no hay
  prevDemeaned: number;   // Señal sin DC de la muestra previa (para aceleración cruda)
  hasPrevDemeaned: boolean;
  // Filtro espectral 1.5 - 18 Hz persistente entre paquetes y acumuladores con olvido (tau ~4 s)
  spX1: number;
  spX2: number;
  spY1: number;
  spY2: number;
  zcAcc: number;
  durAcc: number;
  bandAcc: number;
  totAcc: number;
}

/**
 * Helper unificado canónico para identificar estaciones de la red Raspberry Shake (Item 32)
 * Se basa estrictamente en la red sismológica 'AM' oficial de FDSN.
 */
export function isRaspberryShake(network?: string): boolean {
  return (network || '').trim().toUpperCase() === 'AM';
}

/**
 * Lista blanca de redes institucionales de alta sensibilidad y calidad profesional
 */
export const PROFESSIONAL_NETWORKS = new Set<string>(['IG', 'MX', 'IU', 'CU', 'CI', 'US', 'BC', 'GI', 'SV', 'HN', 'NU', 'NI']);

export function isProfessionalNetwork(network?: string): boolean {
  return PROFESSIONAL_NETWORKS.has((network || '').trim().toUpperCase());
}

/**
 * Helper para identificar estaciones de la red sismológica nacional de México (IG / SSN / MX)
 */
export function isMexicanIGNetwork(network?: string): boolean {
  const net = (network || '').trim().toUpperCase();
  return net === 'IG' || net === 'MX';
}

/**
 * Helper para identificar estaciones de Guatemala (Red INSIVUMEH - GI, red GT, o ubicadas en Guatemala)
 */
export function isGuatemalaStation(stationData?: {
  network?: string;
  stateName?: string;
  state?: string;
  site?: string;
  station?: string;
  code?: string;
  lat?: number;
  lon?: number;
}): boolean {
  if (!stationData) return false;
  const net = (stationData.network || '').trim().toUpperCase();
  if (net === 'GI' || net === 'GT') return true;

  const state = (stationData.stateName || stationData.state || '').toLowerCase();
  if (state.includes('guatemala')) return true;

  const site = (stationData.site || '').toLowerCase();
  if (site.includes('guatemala') || site.includes('insivumeh')) return true;

  const code = (stationData.station || stationData.code || '').trim().toUpperCase();
  if (['EGUA', 'LPAZ', 'ICC1', 'BDG'].includes(code)) return true;

  // Coordenadas geográficas dentro de Guatemala
  const lat = stationData.lat;
  const lon = stationData.lon;
  if (lat !== undefined && lon !== undefined) {
    if (lat >= 13.6 && lat <= 18.1 && lon >= -92.4 && lon <= -88.1) {
      if (net === 'IG' || net === 'MX' || net === 'SV' || net === 'HN') return false;
      return true;
    }
  }

  return false;
}

export function isGuatemalaNetwork(network?: string): boolean {
  const net = (network || '').trim().toUpperCase();
  return net === 'GI' || net === 'GT';
}

/**
 * Helper para identificar estaciones de El Salvador (Red MARN / SNET - red SV, o ubicadas en El Salvador)
 */
export function isElSalvadorStation(stationData?: {
  network?: string;
  stateName?: string;
  state?: string;
  site?: string;
  station?: string;
  code?: string;
  lat?: number;
  lon?: number;
}): boolean {
  if (!stationData) return false;
  const net = (stationData.network || '').trim().toUpperCase();
  if (net === 'SV') return true;

  const state = (stationData.stateName || stationData.state || '').toLowerCase();
  if (state.includes('salvador') || state.includes('sv')) return true;

  const site = (stationData.site || '').toLowerCase();
  if (site.includes('salvador') || site.includes('snet') || site.includes('marn')) return true;

  const code = (stationData.station || stationData.code || '').trim().toUpperCase();
  if (['SNET', 'IGN', 'VSM2', 'UEES', 'UDBS', 'UESV', 'UTEC', 'UNIC', 'UNICI'].includes(code)) return true;

  // Coordenadas geográficas dentro del territorio de El Salvador
  const lat = stationData.lat;
  const lon = stationData.lon;
  if (lat !== undefined && lon !== undefined) {
    if (lat >= 13.0 && lat <= 14.55 && lon >= -90.2 && lon <= -87.5) {
      if (net === 'IG' || net === 'MX' || net === 'GI' || net === 'GT' || net === 'HN' || net === 'NI') return false;
      return true;
    }
  }

  return false;
}

export function isElSalvadorNetwork(network?: string): boolean {
  const net = (network || '').trim().toUpperCase();
  return net === 'SV';
}

/**
 * Helper para identificar estaciones ubicadas en el estado de Chiapas (o zona fronteriza Chiapas/Guatemala)
 */
export function isChiapasStation(stationData?: {
  network?: string;
  stateName?: string;
  state?: string;
  site?: string;
  station?: string;
  code?: string;
  lat?: number;
  lon?: number;
}): boolean {
  if (!stationData) return false;
  const state = (stationData.stateName || stationData.state || '').toLowerCase();
  if (state.includes('chiapas') || state.includes('chis')) return true;

  const site = (stationData.site || '').toLowerCase();
  if (
    site.includes('chiapas') ||
    site.includes('chis') ||
    site.includes('tuxtla') ||
    site.includes('tapachula') ||
    site.includes('pijijiapan') ||
    site.includes('mapastepec') ||
    site.includes('tonala') ||
    site.includes('comitan')
  ) {
    return true;
  }

  const code = (stationData.station || stationData.code || '').trim().toUpperCase();
  if (['TGIG', 'CCIG', 'PAVE', 'ARIG', 'SCIG', 'MEIG', 'CMIG', 'PNO', 'TOIG', 'THIG', 'CHIS', 'TPIG'].includes(code)) {
    return true;
  }

  const lat = stationData.lat;
  const lon = stationData.lon;
  if (lat !== undefined && lon !== undefined) {
    // Polígono de delimitación de Chiapas: latitud 14.3 a 17.9 N, longitud -94.1 a -90.3 O
    if (lat >= 14.3 && lat <= 17.9 && lon >= -94.1 && lon <= -90.3) {
      return true;
    }
  }

  return false;
}

/**
 * Parámetros unificados canónicos para el algoritmo STA/LTA (Item 51)
 * Única fuente de verdad compartida entre DSP, servicio y detector sismológico.
 */
export const DEFAULT_STA_LTA_CONFIG = {
  staSec: 1.0,                            // Ventana corta estándar (1.0 s)
  ltaSec: 20.0,                           // Ventana larga estándar (20.0 s)
  thresholdStandard: 4.8,                 // Ratio estándar para sismómetros institucionales (SV/GI/etc.)
  thresholdProfessionalPureFreq: 4.0,     // Ratio con corroboración espectral en red confiable (1.5 - 18 Hz)
  thresholdIG: 2.1,                       // Ratio para red SSN / IG de México (alta sensibilidad profesional, 2.1)
  thresholdIGPureFreq: 1.7,               // Ratio IG con corroboración espectral (detección rápida de fase P, 1.7)
  thresholdAm: 6.8,                       // Ratio para sensores de bajo costo / ciudadanos (AM / Raspberry Shake)
  thresholdAmPureFreq: 6.0,               // Ratio AM con corroboración espectral
  minPgaStandard: 0.16,                   // PGA mínimo estándar (0.16 gal) para filtrar ruido de fondo y transitorios
  minPgaProfessional: 0.10,               // PGA mínimo para redes profesionales de alta sensibilidad (0.10 gal)
  minPgaIG: 0.030,                        // PGA mínimo para red IG de México (0.030 gal para mayor sensibilidad)
  minPgaAm: 0.45,                         // PGA mínimo para red Raspberry Shake para filtrar ruido local (0.45 gal)
};

// Un disparo sostenido más de este tiempo es tremor o ruido continuo: se libera y penaliza al canal
const MAX_TRIGGER_SEC = 120;
// Tras liberar un disparo la coda del sismo (o del tremor) no se aprende como ruido de fondo durante este tiempo
const POST_TRIGGER_COOLDOWN_SEC = 120;
// Tras un hueco mayor a este tiempo el LTA ya no es representativo y se reconstruye desde cero
const LTA_RESET_GAP_MS = 60000;
// Constante de tiempo de los acumuladores de frecuencia dominante y energía espectral
const SPECTRAL_TAU_SEC = 4.0;
// Una muestra aislada que se aparta más de SPIKE_SIGMA veces el ruido robusto de segunda diferencia es una aguja
const SPIKE_SIGMA = 25;

/**
 * Reemplaza agujas de una sola muestra (glitches de digitalizador/telemetría). Una señal sismológica
 * está limitada en banda, por lo que un salto aislado cuyos vecinos coinciden entre sí no es ground motion.
 * El umbral se calibra con la MAD de la segunda diferencia del propio paquete.
 */
function removeIsolatedSpikes(samples: Int32Array | Float32Array): { data: Int32Array | Float32Array | Float64Array; removed: number } {
  const n = samples.length;
  if (n < 8) return { data: samples, removed: 0 };

  const d2 = new Float64Array(n - 2);
  const absD2 = new Float64Array(n - 2);
  for (let i = 1; i < n - 1; i++) {
    const d = samples[i] - 0.5 * (samples[i - 1] + samples[i + 1]);
    d2[i - 1] = d;
    absD2[i - 1] = Math.abs(d);
  }
  absD2.sort();
  const sigma = Math.max(2.0, 1.4826 * absD2[absD2.length >> 1]);
  const limit = SPIKE_SIGMA * sigma;

  let cleaned: Float64Array | null = null;
  let removed = 0;
  for (let i = 1; i < n - 1; i++) {
    const jump = Math.abs(d2[i - 1]);
    if (jump > limit && Math.abs(samples[i - 1] - samples[i + 1]) < 0.5 * jump) {
      if (!cleaned) cleaned = Float64Array.from(samples);
      cleaned[i] = 0.5 * (samples[i - 1] + samples[i + 1]);
      removed++;
    }
  }
  return { data: cleaned ?? samples, removed };
}

export class SeismicDspEngine {
  private staLtaStates: Map<string, StaLtaState> = new Map();
  private streamStates: Map<string, StreamDspState> = new Map();

  // Parámetros STA/LTA unificados canónicos (Item 51)
  private staSec: number = DEFAULT_STA_LTA_CONFIG.staSec;
  private ltaSec: number = DEFAULT_STA_LTA_CONFIG.ltaSec;
  private triggerThreshold: number = DEFAULT_STA_LTA_CONFIG.thresholdStandard;
  private detrendAlpha: number = 0.98; // Constante de tiempo para el estimador continuo de DC
  private noise: NoiseCalibrator;

  constructor(options?: { staSec?: number; ltaSec?: number; threshold?: number; detrendAlpha?: number; noiseCalibrator?: NoiseCalibrator }) {
    if (options?.staSec !== undefined) this.staSec = options.staSec;
    if (options?.ltaSec !== undefined) this.ltaSec = options.ltaSec;
    if (options?.threshold !== undefined) this.triggerThreshold = options.threshold;
    if (options?.detrendAlpha !== undefined) this.detrendAlpha = options.detrendAlpha;
    this.noise = options?.noiseCalibrator ?? NoiseCalibrator.getInstance();
  }

  /**
   * Transforma la amplitud física en unidades métricas amigables para la UI:
   * µm/s, mm/s o cm/s para velocímetros; µm/s², mm/s² o gal para acelerómetros
   */
  public static formatPhysicalAmplitude(
    valueMps: number,
    inputType: 'VELOCITY' | 'ACCELERATION' = 'VELOCITY'
  ): { value: number; unit: string; formatted: string } {
    const absVal = Math.abs(valueMps);

    if (inputType === 'ACCELERATION') {
      const gal = absVal * 100;
      if (gal < 0.01) {
        const um = absVal * 1e6;
        return { value: Number(um.toFixed(1)), unit: 'µm/s²', formatted: `${um.toFixed(1)} µm/s²` };
      } else if (gal < 1.0) {
        const mm = absVal * 1000;
        return { value: Number(mm.toFixed(2)), unit: 'mm/s²', formatted: `${mm.toFixed(2)} mm/s²` };
      } else {
        return { value: Number(gal.toFixed(3)), unit: 'gal', formatted: `${gal.toFixed(3)} gal` };
      }
    } else {
      // Velocímetro (m/s)
      if (absVal < 0.0001) {
        // Menor a 100 µm/s -> mostrar en micrómetros por segundo (µm/s)
        const um = absVal * 1e6;
        return { value: Number(um.toFixed(1)), unit: 'µm/s', formatted: `${um.toFixed(1)} µm/s` };
      } else if (absVal < 0.01) {
        // Entre 100 µm/s y 10 mm/s -> mostrar en milímetros por segundo (mm/s)
        const mm = absVal * 1000;
        return { value: Number(mm.toFixed(2)), unit: 'mm/s', formatted: `${mm.toFixed(2)} mm/s` };
      } else {
        // 10 mm/s o más -> mostrar en centímetros por segundo (cm/s)
        const cm = absVal * 100;
        return { value: Number(cm.toFixed(2)), unit: 'cm/s', formatted: `${cm.toFixed(2)} cm/s` };
      }
    }
  }

  /**
   * Relación continua de Intensidad Mercalli Modificada (Wald et al., 1999) a partir de PGA (gal = cm/s²):
   * Para MMI > V (PGA >= 66.37 gal): MMI = 3.66 * log10(PGA) - 1.66
   * Para MMI <= V (PGA < 66.37 gal): MMI = 2.20 * log10(PGA) + 1.00
   * Proporciona una transición matemática continua sin escalones artificiales (Item 25).
   */
  public static pgaToContinuousMmi(pgaGal: number): number {
    if (!pgaGal || pgaGal <= 0.04) return 0.0;
    const logPga = Math.log10(Math.max(0.01, pgaGal));
    let mmi: number;
    if (pgaGal >= 66.37) {
      mmi = 3.66 * logPga - 1.66;
    } else {
      mmi = 2.20 * logPga + 1.00;
    }
    return Math.max(0.0, Math.min(10.0, mmi));
  }

  /**
   * Mapea Aceleración Máxima del Suelo (PGA en gal = cm/s^2) a Intensidad Mercalli Modificada (MMI)
   * Discretiza la fórmula continua de Wald et al. (1999) garantizando consistencia absoluta (Item 25).
   */
  public static pgaToMercalli(pgaGal: number): number {
    const continuous = SeismicDspEngine.pgaToContinuousMmi(pgaGal);
    if (continuous < 0.5) return 0;
    return Math.max(1, Math.min(10, Math.round(continuous)));
  }

  /**
   * Procesa un bloque de muestras digitales según los 3 pasos de calibración física:
   * 1. Centrar la señal: calcular la media del búfer y restárselo a cada muestra (forzando reposo a cero).
   * 2. Convertir a velocidad/aceleración: Amplitud = (Cuentas - Media) / Sensibilidad.
   * 3. Ajustar unidades métricas amigables en la UI (µm/s, mm/s, cm/s, gal) y cálculo riguroso de PGA.
   */
  public processSamples(
    network: string,
    station: string,
    channel: string,
    sampleRate: number,
    startTimeIso: string,
    samples: Int32Array | Float32Array,
    meta?: StationChannelMeta
  ): ProcessedPacketResult {
    const streamKey = `${network}.${station}.${channel}`;
    const dt = sampleRate > 0 ? 1.0 / sampleRate : 0.05;
    const count = samples.length;
    const packetStartMs = new Date(startTimeIso).getTime();

    const rawArray: number[] = new Array(count);
    const accelArray: number[] = new Array(count);
    const rawAccArray: number[] = new Array(count);

    // Las agujas aisladas se eliminan antes de cualquier filtro para que no exciten los biquads ni el STA/LTA
    const despiked = removeIsolatedSpikes(samples);
    const data = despiked.data;

    // =========================================================================
    // PASO 1: Estimador de DC corrido persistido por stream y detección de gaps
    // dc = alpha * dc + (1 - alpha) * x[i] continuo entre paquetes.
    // Si startTime del nuevo paquete != endTime del anterior, se reinicia el estado
    // de velocidad para evitar el escalón espurio de derivada (v[0]_n - v[last]_n-1)/dt.
    // =========================================================================
    // Calcular media del paquete para remoción instantánea de DC sin retraso transitorio
    let sumRawInit = 0;
    for (let i = 0; i < count; i++) {
      sumRawInit += data[i];
    }
    const packetMean = count > 0 ? sumRawInit / count : (data[0] || 0);
    const initialRaw = data[0] !== undefined ? data[0] : packetMean;

    let streamState = this.streamStates.get(streamKey);
    if (!streamState) {
      streamState = {
        dc: packetMean,
        prevRaw: initialRaw,
        prevHp: 0,
        prevVelocity: 0,
        prevAccel: 0,
        lastEndTimeMs: 0,
        hasWarmStart: false,
        warmupSamples: 0,
        bp1_x1: 0,
        bp1_x2: 0,
        bp1_y1: 0,
        bp1_y2: 0,
        bp2_x1: 0,
        bp2_x2: 0,
        bp2_y1: 0,
        bp2_y2: 0,
        waX1: 0,
        waX2: 0,
        waY1: 0,
        waY2: 0,
        prevCfInput: NaN,
        prevDemeaned: 0,
        hasPrevDemeaned: false,
        spX1: 0,
        spX2: 0,
        spY1: 0,
        spY2: 0,
        zcAcc: 0,
        durAcc: 0,
        bandAcc: 0,
        totAcc: 0,
      };
      this.streamStates.set(streamKey, streamState);
    }

    // Comprobar discontinuidad temporal (gap)
    const maxAcceptableGapMs = Math.max(180, dt * 2500);
    const hasGap = streamState.lastEndTimeMs > 0 && Math.abs(packetStartMs - streamState.lastEndTimeMs) > maxAcceptableGapMs;
    if (hasGap) {
      const gapMs = Math.abs(packetStartMs - streamState.lastEndTimeMs);
      // Reiniciar estado cinemático para no derivar a través del hueco temporal
      streamState.dc = packetMean;
      streamState.prevRaw = initialRaw;
      streamState.prevHp = 0;
      streamState.prevVelocity = 0;
      streamState.prevAccel = 0;
      streamState.hasWarmStart = false;
      streamState.warmupSamples = 0;
      streamState.bp1_x1 = 0;
      streamState.bp1_x2 = 0;
      streamState.bp1_y1 = 0;
      streamState.bp1_y2 = 0;
      streamState.bp2_x1 = 0;
      streamState.bp2_x2 = 0;
      streamState.bp2_y1 = 0;
      streamState.bp2_y2 = 0;
      streamState.waX1 = 0;
      streamState.waX2 = 0;
      streamState.waY1 = 0;
      streamState.waY2 = 0;
      streamState.prevCfInput = NaN;
      streamState.prevDemeaned = 0;
      streamState.hasPrevDemeaned = false;
      streamState.spX1 = 0;
      streamState.spX2 = 0;
      streamState.spY1 = 0;
      streamState.spY2 = 0;

      // P-05: tras el hueco no se puede arrastrar un disparo en curso; el LTA solo se descarta si el hueco
      // es largo (el nivel de ruido pudo cambiar); de lo contrario se conserva y evita minutos de ceguera.
      const staStateOnGap = this.staLtaStates.get(streamKey);
      if (staStateOnGap) {
        staStateOnGap.triggered = false;
        staStateOnGap.frozenSamples = 0;
        staStateOnGap.triggerCandidateSamples = 0;
        staStateOnGap.triggerCandidateTimeMs = undefined;
        staStateOnGap.lastRatio = 1.0;
        if (gapMs > LTA_RESET_GAP_MS) {
          staStateOnGap.sta = 0;
          staStateOnGap.lta = 0;
          staStateOnGap.totalSamples = 0;
        } else {
          staStateOnGap.sta = staStateOnGap.lta;
        }
      }
    }

    if (isNaN(streamState.dc)) {
      streamState.dc = packetMean;
      streamState.prevRaw = initialRaw;
      streamState.prevHp = 0;
    }

    // =========================================================================
    // PASO 2: Convertir a velocidad o aceleración utilizando la ganancia del canal
    // Amplitud = (Cuentas - DC) / Sensibilidad
    // Transforma la señal digital abstracta en unidades métricas reales (m/s o m/s²)
    // =========================================================================
    const isRaspberryShakeStation = isRaspberryShake(network);
    const isSVStation = isElSalvadorStation({ network, station, code: station });
    const isPaveStation = (station || '').trim().toUpperCase() === 'PAVE';
    const isAccelerometer =
      channel.startsWith('HN') ||
      channel.startsWith('EN') ||
      channel.startsWith('BN') ||
      channel.startsWith('LN') ||
      (channel.length >= 2 && channel[1] === 'N') ||
      meta?.inputType === 'ACCELERATION';

    let sensitivity = meta?.sensitivity;
    // Si es la estación PAVE y trae la sensibilidad errónea (5115800) o < 100M, corregir a la nominal de banda ancha SSN (628460000)
    if (isPaveStation && (!sensitivity || sensitivity < 100000000)) {
      sensitivity = 628460000;
    }
    if (!sensitivity || sensitivity <= 0) {
      if (isAccelerometer) {
        // Red MARN El Salvador / SSN / Raspberry Shake MEMS
        sensitivity = isRaspberryShakeStation ? 408000 : 400000;
      } else if (channel.startsWith('EH') || channel.startsWith('SH') || isRaspberryShakeStation) {
        // Raspberry Shake Geófono 4.5Hz (EHZ, SHZ): Calibración nominal ~399,650,000 cnts / (m/s)
        sensitivity = 399650000;
      } else {
        // Red Central SSN México / MARN El Salvador (BHZ, HHZ): ~629,145,000 cnts / (m/s)
        sensitivity = isSVStation ? 629145000 : 628460000;
      }
    }

    // =========================================================================
    // CONFIGURACIÓN DE FILTROS DIGITALES
    // P-02: Filtro Butterworth Pasa-Banda Orden 4 (1.0 - 10.0 Hz) en 2 biquads en cascada
    //       Calculado por transformación bilineal para suprimir microsismo oceánico (<0.8 Hz)
    //       y rechazar ruido cultural urbano de alta frecuencia (>12 Hz).
    // P-04: El mismo pasa-banda se aplica a la rama de acelerómetro (HN*) para el STA/LTA.
    // =========================================================================
    const fs = sampleRate > 0 ? sampleRate : 20;

    // Cálculo analítico de coeficientes Butterworth orden 4 pasa-banda (1.0 - 10.0 Hz)
    const fLow = 1.0;
    const fHigh = Math.min(10.0, fs * 0.45);
    const w1 = 2 * fs * Math.tan((Math.PI * fLow) / fs);
    const w2 = 2 * fs * Math.tan((Math.PI * fHigh) / fs);
    const B = Math.max(0.1, w2 - w1);
    const w0sq = w1 * w2;
    const sp_re = -Math.SQRT1_2;
    const sp_im = Math.SQRT1_2;
    const disc_re = -4 * w0sq;
    const disc_im = -B * B;
    const mag_disc = Math.hypot(disc_re, disc_im);
    const arg_disc = Math.atan2(disc_im, disc_re);
    const sqrt_disc_re = Math.sqrt(mag_disc) * Math.cos(arg_disc / 2);
    const sqrt_disc_im = Math.sqrt(mag_disc) * Math.sin(arg_disc / 2);
    const p1_re = (B * sp_re + sqrt_disc_re) / 2;
    const p1_im = (B * sp_im + sqrt_disc_im) / 2;
    const p2_re = (B * sp_re - sqrt_disc_re) / 2;
    const p2_im = (B * sp_im - sqrt_disc_im) / 2;

    const sToZ = (pre: number, pim: number) => {
      const num_re = 2 * fs + pre;
      const num_im = pim;
      const den_re = 2 * fs - pre;
      const den_im = -pim;
      const den_magsq = den_re * den_re + den_im * den_im;
      return {
        re: (num_re * den_re + num_im * den_im) / den_magsq,
        im: (num_im * den_re - num_re * den_im) / den_magsq,
      };
    };

    const z1 = sToZ(p1_re, p1_im);
    const z2 = sToZ(p2_re, p2_im);
    const a1_1 = -2 * z1.re;
    const a2_1 = z1.re * z1.re + z1.im * z1.im;
    const a1_2 = -2 * z2.re;
    const a2_2 = z2.re * z2.re + z2.im * z2.im;

    const fCenter = Math.sqrt(fLow * fHigh);
    const wCenter = (2 * Math.PI * fCenter) / fs;
    const biquadResp = (b0: number, a1: number, a2: number, w: number) => {
      const cosw = Math.cos(w);
      const cos2w = Math.cos(2 * w);
      const sinw = Math.sin(w);
      const sin2w = Math.sin(2 * w);
      const num_re = b0 * (1 - cos2w);
      const num_im = b0 * sin2w;
      const den_re = 1 + a1 * cosw + a2 * cos2w;
      const den_im = -(a1 * sinw + a2 * sin2w);
      return Math.hypot(num_re, num_im) / Math.hypot(den_re, den_im);
    };

    const g1 = biquadResp(1, a1_1, a2_1, wCenter) || 1;
    const g2 = biquadResp(1, a1_2, a2_2, wCenter) || 1;
    const bp1_b0 = 1 / g1;
    const bp2_b0 = 1 / g2;

    // Coeficientes Wood-Anderson estándar (T0 = 0.8s, h = 0.8, V = 2080)
    const wa_w0 = (2 * Math.PI) / 0.8;
    const wa_h = 0.8;
    const wa_V = 2080.0;
    const wa_K = 2.0 / dt;
    const wa_d0 = wa_K * wa_K + 2 * wa_h * wa_w0 * wa_K + wa_w0 * wa_w0;
    const wa_b0 = (-wa_V * 1000.0) / wa_d0;
    const wa_b1 = 2 * wa_b0;
    const wa_b2 = wa_b0;
    const wa_a1 = (2 * (wa_w0 * wa_w0 - wa_K * wa_K)) / wa_d0;
    const wa_a2 = (wa_K * wa_K - 2 * wa_h * wa_w0 * wa_K + wa_w0 * wa_w0) / wa_d0;

    let maxAbsAccel = 0;
    let maxAbsVelocity = 0;
    let maxAbsWoodAndersonMm = 0;
    let sumSq = 0;
    let sumRaw = 0;

    // P-02: Array para función característica de STA/LTA calculada en velocidad filtrada 1.0 - 10.0 Hz
    const cfArray: number[] = new Array(count);

    // Factor continuo para remoción de DC (fc ~ 0.05 Hz)
    const dcAlpha = Math.max(0.990, Math.min(0.9995, 1.0 - (2.0 * Math.PI * 0.05 * dt)));

    // Duración de calentamiento (1.5s / mínimo 25 muestras) para asentar filtros IIR y evitar transitorios espurios al cargar estaciones
    const minWarmupSamples = Math.max(25, Math.round(sampleRate * 1.5));

    for (let i = 0; i < count; i++) {
      let raw = data[i];

      // Filtrar glitches y picos espurios aislados (agujas de 1 muestra) en telemetría digital de El Salvador
      if (isSVStation && count > 4 && i > 0 && i < count - 1) {
        const prev = samples[i - 1];
        const next = samples[i + 1];
        if (Math.abs(raw - prev) > 35000 && Math.abs(raw - next) > 35000 && Math.abs(prev - next) < 6000) {
          raw = (prev + next) / 2;
        }
      }

      // Filtrar saturación instrumental y picos de digitalizador en estación IG.PAVE
      if (isPaveStation && count > 2 && i > 0 && i < count - 1) {
        const prev = samples[i - 1];
        const next = samples[i + 1];
        if (Math.abs(raw - prev) > 40000 && Math.abs(raw - next) > 40000 && Math.abs(prev - next) < 10000) {
          raw = (prev + next) / 2;
        }
      }

      rawArray[i] = raw;
      sumRaw += raw;

      // P-03: Filtro paso-altas de un polo continuo recursivo para remoción de DC sin discontinuidades
      // y_hp[n] = dcAlpha * (y_hp[n-1] + x[n] - x[n-1])
      const hp = dcAlpha * (streamState.prevHp + raw - streamState.prevRaw);
      streamState.prevRaw = raw;
      streamState.prevHp = hp;
      streamState.dc = raw - hp;
      const demeaned = hp;

      let aGal = 0;
      let vFiltMetric = 0;
      // La función característica solo es válida con los filtros asentados; durante el calentamiento no alimenta el STA/LTA
      let cfOk = true;
      let rawAccGal = 0;

      if (isAccelerometer) {
        // Acelerómetro: Amplitud = Demeaned / Sensibilidad [m/s²]
        const aMps2 = demeaned / sensitivity;
        const absA_Mps2 = Math.abs(aMps2);
        if (absA_Mps2 > maxAbsVelocity) maxAbsVelocity = absA_Mps2;

        // P-04: Pasar aceleración por filtro paso-banda 1.0 - 10.0 Hz para alimentar el STA/LTA sin derivas
        const s1 = bp1_b0 * (aMps2 - streamState.bp1_x2) - a1_1 * streamState.bp1_y1 - a2_1 * streamState.bp1_y2;
        streamState.bp1_x2 = streamState.bp1_x1;
        streamState.bp1_x1 = aMps2;
        streamState.bp1_y2 = streamState.bp1_y1;
        streamState.bp1_y1 = s1;

        const s2 = bp2_b0 * (s1 - streamState.bp2_x2) - a1_2 * streamState.bp2_y1 - a2_2 * streamState.bp2_y2;
        streamState.bp2_x2 = streamState.bp2_x1;
        streamState.bp2_x1 = s1;
        streamState.bp2_y2 = streamState.bp2_y1;
        streamState.bp2_y1 = s2;

        vFiltMetric = s2; // Aceleración filtrada en m/s²

        if (streamState.warmupSamples < minWarmupSamples) {
          streamState.warmupSamples++;
          aGal = 0;
          vFiltMetric = 0;
          cfOk = false;
        } else {
          streamState.hasWarmStart = true;
          aGal = aMps2 * 100;
          rawAccGal = aGal;
          if (isRaspberryShakeStation) {
            aGal = Number((aGal * 0.96).toFixed(4));
          }
        }
        streamState.prevAccel = aGal;
      } else {
        // Velocímetro: Amplitud = Demeaned / Sensibilidad [m/s]
        const vMps = demeaned / sensitivity;
        const absV = Math.abs(vMps);
        if (absV > maxAbsVelocity) maxAbsVelocity = absV;

        // P-02: Filtro Butterworth orden 4 pasa-banda (1.0 - 10.0 Hz) en 2 biquads en cascada
        const s1 = bp1_b0 * (vMps - streamState.bp1_x2) - a1_1 * streamState.bp1_y1 - a2_1 * streamState.bp1_y2;
        streamState.bp1_x2 = streamState.bp1_x1;
        streamState.bp1_x1 = vMps;
        streamState.bp1_y2 = streamState.bp1_y1;
        streamState.bp1_y1 = s1;

        const s2 = bp2_b0 * (s1 - streamState.bp2_x2) - a1_2 * streamState.bp2_y1 - a2_2 * streamState.bp2_y2;
        streamState.bp2_x2 = streamState.bp2_x1;
        streamState.bp2_x1 = s1;
        streamState.bp2_y2 = streamState.bp2_y1;
        streamState.bp2_y1 = s2;

        vFiltMetric = s2; // Velocidad filtrada en m/s (óptima para STA/LTA sin sesgo HF)

        if (streamState.warmupSamples < minWarmupSamples) {
          streamState.warmupSamples++;
          aGal = 0;
          vFiltMetric = 0;
          cfOk = false;
          streamState.prevVelocity = s2;
        } else {
          if (!streamState.hasWarmStart) {
            streamState.hasWarmStart = true;
            streamState.prevVelocity = s2;
            aGal = 0;
          } else {
            // Derivada numérica para PGA / Intensidad
            const aMps2 = (s2 - streamState.prevVelocity) / dt;
            aGal = aMps2 * 100;
            if (isRaspberryShakeStation) {
              aGal = Number((aGal * 0.96).toFixed(4));
            }
          }
          streamState.prevVelocity = s2;
          // Aceleración cruda (sin pasa-banda) para discriminar el contenido espectral del paquete
          if (streamState.hasPrevDemeaned) rawAccGal = ((vMps - streamState.prevDemeaned) / dt) * 100;
        }
        streamState.prevDemeaned = vMps;
        streamState.hasPrevDemeaned = true;
        streamState.prevAccel = aGal;
      }

      accelArray[i] = Number(aGal.toFixed(4));
      cfArray[i] = cfOk ? vFiltMetric : NaN;
      rawAccArray[i] = rawAccGal;

      const absA = Math.abs(aGal);
      if (absA > maxAbsAccel) maxAbsAccel = absA;
      sumSq += aGal * aGal;

      // Item 20: Sintetizar respuesta Wood-Anderson estándar para cálculo dimensionalmente correcto de ML
      const aInMps2 = aGal / 100;
      const waDispMm = wa_b0 * aInMps2 + wa_b1 * streamState.waX1 + wa_b2 * streamState.waX2
                       - wa_a1 * streamState.waY1 - wa_a2 * streamState.waY2;
      streamState.waX2 = streamState.waX1;
      streamState.waX1 = aInMps2;
      streamState.waY2 = streamState.waY1;
      streamState.waY1 = waDispMm;
      const absWa = Math.abs(waDispMm);
      if (absWa > maxAbsWoodAndersonMm) maxAbsWoodAndersonMm = absWa;
    }

    // Actualizar timestamp final del paquete para validación de continuidad en el siguiente
    const durationMs = (count * dt) * 1000;
    streamState.lastEndTimeMs = packetStartMs + durationMs;

    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    
    // Item 23: Guardar el PGA real sin forzar discontinuidad artificial (se retiró el sobre-escrito pga = 0.001)
    const isWarmedUp = streamState.hasWarmStart && streamState.warmupSamples >= minWarmupSamples;
    const pga = isWarmedUp ? Number(maxAbsAccel.toFixed(4)) : 0;
    const pgaStr = `${pga.toFixed(4)} gal`;
    const continuousMmi = isWarmedUp ? SeismicDspEngine.pgaToContinuousMmi(pga) : 1.0;
    const intensityMMI = isWarmedUp ? SeismicDspEngine.pgaToMercalli(pga) : 1;

    // =========================================================================
    // PASO 3: Ajustar las unidades en la UI a una escala amigable
    // µm/s, mm/s, cm/s para que las estaciones sean 100% comparables entre sí
    // =========================================================================
    const effectiveAmp = isWarmedUp ? maxAbsVelocity : 0;
    const formattedAmp = SeismicDspEngine.formatPhysicalAmplitude(
      effectiveAmp,
      isAccelerometer ? 'ACCELERATION' : 'VELOCITY'
    );

    // =========================================================================
    // VALIDACIÓN DE ENERGÍA Y FRECUENCIA SÍSMICA (1.5 - 18.0 Hz)
    // Filtro IIR Butterworth pasabanda para aislar ondas P y discriminar ruido.
    // Rango ampliado a 18 Hz para capturar microsismos locales de alta frecuencia.
    // =========================================================================
    const specFLow = 1.5;
    const specFHigh = Math.min(fs * 0.45, 18.0);
    const specFCenter = Math.sqrt(Math.max(0.5, specFLow * specFHigh));
    const specBw = Math.max(0.5, specFHigh - specFLow);
    const specW0 = (2 * Math.PI * specFCenter) / fs;
    const specQ = Math.max(0.1, specFCenter / specBw);
    const specAlpha = Math.sin(specW0) / (2 * specQ);
    const specB0 = specAlpha;
    const specB2 = -specAlpha;
    const specA0 = 1 + specAlpha;
    const specA1 = -2 * Math.cos(specW0);
    const specA2 = 1 - specAlpha;

    const nb0 = specB0 / specA0;
    const nb2 = specB2 / specA0;
    const na1 = specA1 / specA0;
    const na2 = specA2 / specA0;

    let seismicBandEnergy = 0;
    let totalEnergy = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < count; i++) {
      // Aceleración cruda sin pasa-banda: el contenido fuera de 1.5 - 18 Hz solo se aprecia en esta señal
      const x0 = rawAccArray[i];
      totalEnergy += x0 * x0;

      // Filtro biquad paso-banda directo con estado persistente entre paquetes
      const yPrev = streamState.spY1;
      const y0 = nb0 * x0 + nb2 * streamState.spX2 - na1 * streamState.spY1 - na2 * streamState.spY2;
      streamState.spX2 = streamState.spX1;
      streamState.spX1 = x0;
      streamState.spY2 = streamState.spY1;
      streamState.spY1 = y0;

      seismicBandEnergy += y0 * y0;

      if ((y0 >= 0) !== (yPrev >= 0)) zeroCrossings++;
    }

    // Los acumuladores con olvido evitan que un paquete corto de unas decenas de muestras decida el umbral
    const durationSec = count * dt;
    const spectralDecay = Math.exp(-durationSec / SPECTRAL_TAU_SEC);
    streamState.zcAcc = streamState.zcAcc * spectralDecay + zeroCrossings;
    streamState.durAcc = streamState.durAcc * spectralDecay + durationSec;
    streamState.bandAcc = streamState.bandAcc * spectralDecay + seismicBandEnergy;
    streamState.totAcc = streamState.totAcc * spectralDecay + totalEnergy;

    const estimatedFreqHz = streamState.durAcc > 0 ? Number((streamState.zcAcc / (2 * streamState.durAcc)).toFixed(1)) : 5.0;
    const seismicBandRatio = streamState.totAcc > 1e-6 ? Number(Math.min(1.0, streamState.bandAcc / streamState.totAcc).toFixed(2)) : 0.0;

    // Frecuencia pura sísmica: dominante en 1.5 - 18.0 Hz Y ratio de energía en banda >= 0.35
    // Admite microsismos locales cercanos que concentran energía entre 10 y 18 Hz
    const isPureFrequencySeismic = (estimatedFreqHz >= 1.5 && estimatedFreqHz <= 18.0) && (seismicBandRatio >= 0.35);

    // =========================================================================
    // ALGORITMO RECURSIVO STA/LTA CON ARRANQUE POR MEDIA ACUMULADA Y LTA CONGELADO
    // Los umbrales se calibran con el ruido real de cada canal (NoiseCalibrator)
    // =========================================================================
    let staState = this.staLtaStates.get(streamKey);
    if (!staState) {
      staState = {
        sta: 0,
        lta: 0,
        lastRatio: 1.0,
        triggered: false,
        totalSamples: 0,
        frozenSamples: 0,
        triggerCandidateSamples: 0,
        triggerCandidateTimeMs: undefined,
      };
      this.staLtaStates.set(streamKey, staState);
    }

    const isProf = isProfessionalNetwork(network);
    const isIG = isMexicanIGNetwork(network);

    // Umbral adaptado según pureza de frecuencia sísmica usando configuración unificada (Item 51)
    let effectiveThreshold = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdProfessionalPureFreq : this.triggerThreshold;
    if (isRaspberryShakeStation) {
      effectiveThreshold = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdAmPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdAm;
    } else if (isIG) {
      effectiveThreshold = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdIGPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdIG;
    } else if (isProf) {
      effectiveThreshold = isPureFrequencySeismic ? DEFAULT_STA_LTA_CONFIG.thresholdProfessionalPureFreq : DEFAULT_STA_LTA_CONFIG.thresholdStandard;
    }

    const effectiveStaSec = isRaspberryShakeStation ? DEFAULT_STA_LTA_CONFIG.staSec : this.staSec;
    const effectiveLtaSec = isRaspberryShakeStation ? DEFAULT_STA_LTA_CONFIG.ltaSec : this.ltaSec;

    // Piso absoluto según red: IG 0.03 gal, profesional 0.10 gal, estándar 0.16 gal, AM 0.45 gal
    const minPgaBase = isRaspberryShakeStation
      ? DEFAULT_STA_LTA_CONFIG.minPgaAm
      : (isIG ? DEFAULT_STA_LTA_CONFIG.minPgaIG : (isProf ? DEFAULT_STA_LTA_CONFIG.minPgaProfessional : DEFAULT_STA_LTA_CONFIG.minPgaStandard));

    // Umbrales finales del canal: max(base de la red, ruido aprendido * margen), con penalización y cuarentena
    const noiseKey = NoiseCalibrator.streamKey(network, station, channel);
    const thr = this.noise.getThresholds(noiseKey, { network, station, channel }, { ratio: effectiveThreshold, minPgaGal: minPgaBase });

    const nSta = Math.max(2, Math.round(effectiveStaSec * sampleRate));
    const nLta = Math.max(10, Math.round(effectiveLtaSec * sampleRate));
    const cSta = Math.exp(-1.0 / nSta);
    const cLta = Math.exp(-1.0 / nLta);

    // Tope al LTA congelado: máximo 60 s antes de adaptar LTA al nuevo nivel de ruido
    const maxFreezeSamples = Math.round(60.0 * sampleRate);
    const maxTriggerSamples = Math.round(MAX_TRIGGER_SEC * sampleRate);
    const minTriggerSamples = Math.max(3, Math.round(0.15 * sampleRate));
    // Piso de cuantización de la función característica: (1 cuenta en unidades físicas)^2 / 12
    const epsCf = 1.0 / (sensitivity * sensitivity * 12.0);
    // Coeficiente de balance dimensional de Allen (fc ~ 2.5 Hz para banda de ondas P)
    const cAllen = 1.0 / (4.0 * Math.PI * Math.PI * 6.25);

    let packetPeakRaw = 0;
    for (let i = 0; i < count; i++) {
      const dev = Math.abs(data[i] - packetMean);
      if (dev > packetPeakRaw) packetPeakRaw = dev;
    }
    const rawSignalThreshold = Math.max(100, packetPeakRaw * 0.05);

    let currentRatio = staState.lastRatio;
    let isTriggered = staState.triggered;
    const triggeredAtStart = isTriggered;
    const inCooldownAtStart = (staState.postTriggerSamples ?? 0) > 0;
    const cooldownSamples = Math.round(POST_TRIGGER_COOLDOWN_SEC * sampleRate);
    let triggerSampleIndex: number | null = null;
    let triggerTimeIso: string | null = null;
    let packetPeakRatio = 0;
    let stuckReleased = false;

    // Ventana deslizante del PGA reciente (cola monótona, O(1) amortizado) y conteo de muestras con señal cruda apreciable
    const absAcc = new Float64Array(count);
    const peakQueue = new Int32Array(count);
    let qHead = 0;
    let qTail = 0;
    const rawFlags = new Uint8Array(count);
    let rawSignalCount = 0;

    for (let i = 0; i < count; i++) {
      const aGalAbs = Math.abs(accelArray[i]);
      // Item 12: usar solo la energía reciente de la ventana STA; no conservar un pico aislado durante todo el paquete.
      absAcc[i] = aGalAbs;
      while (qTail > qHead && absAcc[peakQueue[qTail - 1]] <= aGalAbs) qTail--;
      peakQueue[qTail++] = i;
      if (peakQueue[qHead] <= i - nSta) qHead++;
      const recentPeakPga = absAcc[peakQueue[qHead]];

      const rawFlag = Math.abs(data[i] - packetMean) >= rawSignalThreshold ? 1 : 0;
      rawFlags[i] = rawFlag;
      rawSignalCount += rawFlag;
      if (i >= nSta) rawSignalCount -= rawFlags[i - nSta];

      // Durante el calentamiento de los filtros no hay señal válida: no alimenta STA ni LTA
      const cfVal = cfArray[i];
      if (Number.isNaN(cfVal)) continue;

      // Función Característica de Allen (Arquitectura GlobalQuake 0.11.0):
      // CF[i] = x[i]^2 + C * (dx/dt)^2, con la derivada continua entre paquetes
      const prevCf = streamState.prevCfInput;
      const derivVal = Number.isNaN(prevCf) ? 0 : (cfVal - prevCf) / dt;
      streamState.prevCfInput = cfVal;
      const cf = cfVal * cfVal + cAllen * derivVal * derivVal;

      // Arranque por media acumulada: STA y LTA se llenan con datos reales sin depender de un valor inicial arbitrario
      staState.totalSamples++;
      const n = staState.totalSamples;
      if (!isTriggered && (staState.postTriggerSamples ?? 0) > 0) staState.postTriggerSamples!--;
      staState.sta += Math.max(1.0 - cSta, 1.0 / n) * (cf - staState.sta);

      // Item 8: LTA se congela durante el disparo para evitar colapso de ratio en sacudida sostenida
      // P-06: Si frozenSamples supera el tope, se actualiza el LTA gradualmente para adaptarse al nuevo nivel de ruido
      if (!isTriggered) {
        staState.frozenSamples = 0;
        staState.lta += Math.max(1.0 - cLta, 1.0 / n) * (cf - staState.lta);
      } else {
        staState.frozenSamples = (staState.frozenSamples || 0) + 1;
        if (staState.frozenSamples > maxFreezeSamples) {
          staState.lta += Math.max(1.0 - cLta, 1.0 / n) * (cf - staState.lta);
        }
      }

      const ratio = staState.sta / (staState.lta + epsCf);
      currentRatio = ratio;

      // Item 7: Guardia de calentamiento: no permitir disparo hasta llenar la ventana LTA completa
      const ltaReady = staState.totalSamples >= nLta;
      if (ltaReady && ratio > packetPeakRatio) packetPeakRatio = ratio;

      // Un movimiento fuerte (muy por encima del ruido del canal) dispara aunque el canal esté calibrando o en cuarentena
      const strongMotion = recentPeakPga >= thr.strongMotionGal;
      const calibratedPass = !thr.quarantined && ratio >= thr.ratioThreshold && recentPeakPga >= thr.minPgaGal;
      const strongPass = strongMotion && ratio >= effectiveThreshold;

      const triggerCondition = ltaReady &&
        rawSignalCount >= minTriggerSamples &&
        (calibratedPass || strongPass);
      if (triggerCondition) {
        if (!isTriggered) {
          staState.triggerCandidateSamples = (staState.triggerCandidateSamples || 0) + 1;
          if (staState.triggerCandidateSamples === 1) {
            staState.triggerCandidateTimeMs = packetStartMs + Math.round(i * dt * 1000);
          }
          if (staState.triggerCandidateSamples >= minTriggerSamples) {
            isTriggered = true;
            const candidateTimeMs = staState.triggerCandidateTimeMs || packetStartMs + Math.round(i * dt * 1000);
            triggerSampleIndex = Math.max(0, Math.round((candidateTimeMs - packetStartMs) / (dt * 1000)));
            triggerTimeIso = new Date(candidateTimeMs).toISOString();
            staState.triggerTime = triggerTimeIso;
          }
        } else if ((staState.frozenSamples || 0) > maxTriggerSamples) {
          // Disparo sostenido (tremor, ruido continuo): se libera y se penaliza al canal
          staState.lta = Math.max(staState.lta, staState.sta * 0.7);
          isTriggered = false;
          staState.frozenSamples = 0;
          staState.triggerCandidateSamples = 0;
          staState.triggerCandidateTimeMs = undefined;
          staState.postTriggerSamples = cooldownSamples;
          stuckReleased = true;
        }
      } else {
        staState.triggerCandidateSamples = 0;
        staState.triggerCandidateTimeMs = undefined;
        if (
          isTriggered &&
          (ratio < thr.ratioThreshold * 0.50 ||
            recentPeakPga < thr.minPgaGal * 0.65 ||
            !ltaReady ||
            (thr.quarantined && !strongMotion) ||
            (staState.frozenSamples && staState.frozenSamples > maxFreezeSamples * 0.8))
        ) {
          // P-06: Al salir del disparo, actualizar suavemente el LTA con el nivel STA actual
          // para no re-disparar inmediatamente en la siguiente muestra por tener LTA desactualizado
          staState.lta = Math.max(staState.lta, staState.sta * 0.7);
          isTriggered = false;
          staState.frozenSamples = 0;
          staState.postTriggerSamples = cooldownSamples;
        }
      }
    }

    staState.lastRatio = Number(currentRatio.toFixed(2));
    staState.triggered = isTriggered;

    // Retroalimentación al calibrador: disparo sostenido penaliza; el ruido solo se aprende con el LTA ya lleno
    if (stuckReleased) this.noise.reportStuckTrigger(noiseKey);
    if (isWarmedUp && staState.totalSamples >= nLta) {
      this.noise.observe(noiseKey, { network, station, channel }, {
        peakPga: pga,
        peakRatio: packetPeakRatio,
        durationSec,
        duringTrigger: triggeredAtStart || inCooldownAtStart,
      });
    }

    // Timestamp final del paquete
    const parsedStartMs = new Date(startTimeIso).getTime();
    const startMs = !isNaN(parsedStartMs) ? parsedStartMs : Date.now();
    const endTimeIso = new Date(startMs + durationMs).toISOString();
    const mean = count > 0 ? sumRaw / count : (isNaN(streamState.dc) ? 0 : streamState.dc);

    return {
      station,
      network,
      channel,
      sampleRate,
      startTime: startTimeIso,
      endTime: endTimeIso,
      sampleCount: count,
      rawCounts: rawArray,
      accelerationGal: accelArray,
      pga,
      pgaStr,
      amplitudePhysical: formattedAmp.value,
      amplitudeUnit: formattedAmp.unit,
      amplitudeStr: formattedAmp.formatted,
      maxVelocityMps: maxAbsVelocity,
      woodAndersonDispMm: Number(maxAbsWoodAndersonMm.toFixed(6)),
      continuousMmi: Number(continuousMmi.toFixed(2)),
      intensityMMI,
      meanCount: Math.round(mean),
      rms: Number(rms.toFixed(4)),
      freqDominantHz: estimatedFreqHz,
      highFreqRatio: seismicBandRatio,
      isPureFrequencySeismic,
      staLta: {
        sta: Number(staState.sta.toPrecision(4)),
        lta: Number(staState.lta.toPrecision(4)),
        ratio: staState.lastRatio,
        peakRatio: Number(packetPeakRatio.toFixed(2)),
        thresholdRatio: Number(thr.ratioThreshold.toFixed(2)),
        minPgaGal: Number(thr.minPgaGal.toFixed(4)),
        triggered: isTriggered,
        triggerSampleIndex,
        triggerTimeIso: isTriggered ? staState.triggerTime || triggerTimeIso : null,
      },
      noise: {
        noiseClass: thr.noiseClass,
        ready: thr.ready,
        quarantined: thr.quarantined,
        penalty: Number(thr.penalty.toFixed(2)),
        medianPga: Number(thr.medianPga.toFixed(5)),
        highPga: Number(thr.highPga.toFixed(5)),
        spikesRemoved: despiked.removed,
      },
    };
  }
}
