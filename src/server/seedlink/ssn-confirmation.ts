/**
 * CORROBORACIÓN CON EL CATÁLOGO DEL SSN (SERVICIO SISMOLÓGICO NACIONAL)
 *
 * Una red tan dispersa como la mexicana registra muchos sismos pequeños con una sola estación cercana: no alcanzan
 * para localizarlos por sí solos. El SSN publica el sismo minutos después. Si la llegada P observada en una estación
 * coincide con la que el hipocentro del SSN predice, el sismo queda confirmado con datos explícitos de una fuente
 * oficial (el paso del tiempo nunca confirma nada). Este módulo contiene la lógica de comparación, sin red ni estado.
 */

import { greatCircleKm } from './gq-geo.js';
import { calculateTravelTime1D, elevationCorrectionSec } from './travel-time.js';

export interface ExternalHypocenter {
  timeEpoch: number;
  latitude: number;
  longitude: number;
  depth: number;
}

export interface PickLike {
  tP: number;
  lat: number;
  lon: number;
  elevationM?: number;
}

/** Tolerancia (s) de una llegada P respecto a la predicha por un hipocentro externo */
export function pickToleranceSec(travelSec: number): number {
  return 2.5 + 0.03 * travelSec;
}

/** Residuo (s) de una llegada P respecto a la que predice el hipocentro externo; positivo = llegó tarde */
export function pickResidualSec(hypo: ExternalHypocenter, pick: PickLike): number {
  const distKm = greatCircleKm(hypo.latitude, hypo.longitude, pick.lat, pick.lon);
  const depth = Number.isFinite(hypo.depth) && hypo.depth > 0 ? hypo.depth : 10;
  const travelSec = calculateTravelTime1D(distKm, depth, 'P') + elevationCorrectionSec(pick.elevationM ?? 0);
  return (pick.tP - hypo.timeEpoch) / 1000 - travelSec;
}

export function isPickConsistent(hypo: ExternalHypocenter, pick: PickLike): boolean {
  const distKm = greatCircleKm(hypo.latitude, hypo.longitude, pick.lat, pick.lon);
  const depth = Number.isFinite(hypo.depth) && hypo.depth > 0 ? hypo.depth : 10;
  const travelSec = calculateTravelTime1D(distKm, depth, 'P');
  return Math.abs(pickResidualSec(hypo, pick)) <= pickToleranceSec(travelSec);
}

export interface PreliminaryMatch {
  consistent: number;
  total: number;
  originDiffSec: number;
}

/**
 * ¿El hipocentro externo explica un evento ya detectado? Exige que el origen coincida (±20 s) y que la mayoría de las
 * llegadas P del evento sean compatibles con el hipocentro externo (al menos 2, o todas si son menos de 3).
 */
export function matchDetectedEvent(
  external: ExternalHypocenter,
  detected: { timeEpoch: number },
  picks: PickLike[]
): PreliminaryMatch | null {
  const originDiffSec = Math.abs(detected.timeEpoch - external.timeEpoch) / 1000;
  if (originDiffSec > 20 || picks.length === 0) return null;
  const consistent = picks.filter((p) => isPickConsistent(external, p)).length;
  const needed = picks.length < 3 ? picks.length : Math.max(2, Math.ceil(picks.length * 0.6));
  if (consistent < needed) return null;
  return { consistent, total: picks.length, originDiffSec };
}
