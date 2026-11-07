/**
 * UTILIDADES GEODÉSICAS (ESFERA DE RADIO MEDIO) PARA EL AGRUPAMIENTO Y LA BÚSQUEDA DE HIPOCENTRO
 */

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0;

/** Distancia sobre la superficie (km) por la fórmula de haversine */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Acimut (0 - 360°, norte = 0) del punto 1 al punto 2 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const deg = Math.atan2(y, x) / DEG;
  return deg < 0 ? deg + 360 : deg;
}

/** Punto a `distKm` del origen en la dirección `bearing` (grados desde el norte) */
export function moveOnGlobe(lat: number, lon: number, distKm: number, bearing: number): [number, number] {
  const delta = distKm / EARTH_RADIUS_KM;
  const theta = bearing * DEG;
  const phi1 = lat * DEG;
  const lam1 = lon * DEG;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lam2 = lam1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * sinPhi2
  );
  let lon2 = lam2 / DEG;
  while (lon2 > 180) lon2 -= 360;
  while (lon2 < -180) lon2 += 360;
  return [phi2 / DEG, lon2];
}

/** Promedio geográfico (vectorial en longitud, para no fallar cerca del antimeridiano) */
export function meanLatLon(points: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  if (points.length === 0) return { lat: 0, lon: 0 };
  let sumLat = 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const p of points) {
    sumLat += p.lat;
    sumSin += Math.sin(p.lon * DEG);
    sumCos += Math.cos(p.lon * DEG);
  }
  return { lat: sumLat / points.length, lon: Math.atan2(sumSin / points.length, sumCos / points.length) / DEG };
}
