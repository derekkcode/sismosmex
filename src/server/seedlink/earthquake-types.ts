/**
 * TIPOS COMPARTIDOS DEL DETECTOR: DISPAROS POR ESTACIÓN, CANDIDATOS Y SISMOS DETECTADOS
 */

import type { NoiseClass } from './noise-calibrator.js';

export interface StationTriggerRecord {
  station: string;
  network: string;
  channel: string;
  lat: number;
  lon: number;
  elevationM?: number;
  site: string;
  stateName: string;
  tP: number; // Llegada P (ms), buscada hacia atrás desde el cruce del umbral
  tP_iso: string;
  receivedWallTime?: number; // Timestamp de llegada al servidor (ms)
  tS?: number; // Timestamp de onda S en ms
  tS_iso?: string;
  sWaveExpectedMs?: number; // Hora esperada de arribo de onda S en ms (GlobalQuake)
  sWaveCountdownSec?: number; // Segundos restantes para el impacto de la onda S
  sWaveArrived?: boolean; // True si la onda S ya impactó físicamente la estación
  distanceKm?: number; // Distancia calculada D
  staLtaRatio: number; // Cociente corto/largo máximo del evento de la estación (GlobalQuake)
  maxPga: number;
  maxAmp: number;
  woodAndersonAmpMm?: number; // Amplitud sintetizada Wood-Anderson (mm)
  stationML?: number;
  isPureFrequency?: boolean; // True si la energía está en la banda 4 - 10 Hz
  freqDominantHz?: number;
  highFreqRatio?: number;
  reqRatio?: number; // Umbral de cociente con el que se abrió el evento
  reqPga?: number; // Piso de PGA calibrado del canal (referencia del calibrador de ruido)
  noiseClass?: NoiseClass; // Clasificación de ruido del canal
  lastUpdateWallTime?: number; // Último paquete que alimentó este disparo (ms)
  eventId?: string; // Sismo al que está asociado el disparo
  corroborated?: boolean; // True si el disparo formó parte de un sismo confirmado
  rejected?: boolean; // True si el evento al que pertenecía se retiró sin evidencia: no vuelve a formar otro
  noisePga?: number; // Pico de PGA del ruido previo a la llegada P (gal), medido en la propia estación
  sWindowPga?: number; // Pico de PGA dentro de la ventana de la onda S esperada (gal)
  gqEventId?: number; // Evento del análisis por estación del que proviene el disparo
  residualSec?: number; // Residuo de la llegada P respecto al hipocentro del sismo (s)
}

export interface SeismicCandidate {
  stationCount: number;
  stations: string[];
  firstTriggerTime: string;
}

export function generateDisplayId(id?: string): string {
  if (!id) return '';
  const parts = id.split('-');
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.length >= 3 && lastPart.length <= 6) {
    return lastPart.toUpperCase();
  }
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'EQ';
}

export type ConfirmationBasis = 'NETWORK' | 'S_WAVE' | 'SSN' | 'USGS';

export interface DetectedEarthquake {
  id: string;
  displayId?: string; // ID corto y sutil (ej: 8F3A)
  time: string; // t0 Tiempo de origen (ISO)
  timeEpoch: number; // t0 en ms
  detectedAt: string; // Momento de la declaración de alerta
  latitude: number;
  longitude: number;
  depth: number; // Profundidad estimada en km
  magnitude: number; // Magnitud oficial ML
  magnitudeType: string;
  location: string; // Ej: "24 km al Suroeste de Pinotepa Nacional, Oax"
  maxPga: number; // gal
  maxIntensity: number; // Mercalli (MMI 1 - 10)
  intensityKnown?: boolean; // false cuando la fuente (SSN) no reporta intensidad
  stationCount: number;
  stations: StationTriggerRecord[];
  status: 'PRELIMINARY' | 'CONFIRMED';
  source: string;
  isMicro?: boolean;
  isAlert?: boolean;
  isInter?: boolean;
  category?: string;
  saved?: boolean;
  reportNumber?: number;
  azimuthalGap?: number; // Brecha azimutal máxima en grados (0 - 360)
  rmsResidualSec?: number; // Residuo RMS de las llegadas P correctas (s)
  clusterLevel?: number; // Nivel de escalada del grupo sísmico (1, 2, 3)
  sWaveArrivedCount?: number; // Estaciones que ya registraron el paso de la onda S
  isSWaveConfirmed?: boolean; // True si la onda S ya corroboró la magnitud física
  quality?: string; // Clase de calidad del hipocentro (S, A, B, C, D) según GlobalQuake
  locationUncertaintyKm?: number; // Radio de la región de confianza del epicentro
  depthFixed?: boolean; // true cuando los datos no restringen la profundidad y se asumió un valor somero
  confirmationBasis?: ConfirmationBasis; // Evidencia que confirmó el evento
  isLocked?: boolean; // true cuando el evento ya no se reubica ni se retira por falta de evidencia
  // Alias que la interfaz lee en los eventos externos (USGS)
  lat?: number;
  lon?: number;
  mag?: number;
}
