/**
 * NOMBRE DE LA UBICACIÓN DE UN EPICENTRO: LOCALIDAD DE REFERENCIA MÁS CERCANA (MÉXICO Y CENTROAMÉRICA)
 */

import { greatCircleKm } from './gq-geo.js';

interface ReferenceCity {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

// Localidades y puntos de referencia sísmica en la República Mexicana
export const REFERENCE_CITIES: ReferenceCity[] = [
  { name: 'Acapulco', state: 'Guerrero', lat: 16.85, lon: -99.90 },
  { name: 'Ometepec', state: 'Guerrero', lat: 16.68, lon: -98.40 },
  { name: 'Coyuca de Benítez', state: 'Guerrero', lat: 17.01, lon: -100.08 },
  { name: 'San Marcos', state: 'Guerrero', lat: 16.79, lon: -99.39 },
  { name: 'Zihuatanejo', state: 'Guerrero', lat: 17.64, lon: -101.55 },
  { name: 'Petatlán', state: 'Guerrero', lat: 17.53, lon: -101.27 },
  { name: 'Chilpancingo', state: 'Guerrero', lat: 17.55, lon: -99.50 },
  { name: 'Pinotepa Nacional', state: 'Oaxaca', lat: 16.34, lon: -98.05 },
  { name: 'Puerto Escondido', state: 'Oaxaca', lat: 15.86, lon: -97.07 },
  { name: 'Huatulco', state: 'Oaxaca', lat: 15.76, lon: -96.13 },
  { name: 'Salina Cruz', state: 'Oaxaca', lat: 16.18, lon: -95.20 },
  { name: 'Matías Romero', state: 'Oaxaca', lat: 16.87, lon: -95.04 },
  { name: 'Oaxaca de Juárez', state: 'Oaxaca', lat: 17.06, lon: -96.72 },
  { name: 'Miahuatlán', state: 'Oaxaca', lat: 16.33, lon: -96.59 },
  { name: 'Tonalá', state: 'Chiapas', lat: 16.09, lon: -93.75 },
  { name: 'Pijijiapan', state: 'Chiapas', lat: 15.69, lon: -93.21 },
  { name: 'Mapastepec', state: 'Chiapas', lat: 15.43, lon: -92.90 },
  { name: 'Ciudad Hidalgo', state: 'Chiapas', lat: 14.68, lon: -92.15 },
  { name: 'Tuxtla Gutiérrez', state: 'Chiapas', lat: 16.75, lon: -93.11 },
  { name: 'Coalcomán', state: 'Michoacán', lat: 18.78, lon: -103.16 },
  { name: 'Aquila', state: 'Michoacán', lat: 18.60, lon: -103.50 },
  { name: 'Lázaro Cárdenas', state: 'Michoacán', lat: 17.96, lon: -102.20 },
  { name: 'Playa Azul', state: 'Michoacán', lat: 17.98, lon: -102.35 },
  { name: 'Tecomán', state: 'Colima', lat: 18.91, lon: -103.87 },
  { name: 'Manzanillo', state: 'Colima', lat: 19.05, lon: -104.31 },
  { name: 'Colima', state: 'Colima', lat: 19.24, lon: -103.72 },
  { name: 'Cihuatlán', state: 'Jalisco', lat: 19.23, lon: -104.57 },
  { name: 'Puerto Vallarta', state: 'Jalisco', lat: 20.65, lon: -105.23 },
  { name: 'Autlán de Navarro', state: 'Jalisco', lat: 19.77, lon: -104.36 },
  { name: 'Chiautla de Tapia', state: 'Puebla', lat: 18.30, lon: -98.60 },
  { name: 'Izúcar de Matamoros', state: 'Puebla', lat: 18.60, lon: -98.47 },
  { name: 'Puebla', state: 'Puebla', lat: 19.04, lon: -98.20 },
  { name: 'Cuernavaca', state: 'Morelos', lat: 18.92, lon: -99.23 },
  { name: 'Ciudad de México', state: 'Ciudad de México', lat: 19.43, lon: -99.13 },
  { name: 'Toluca', state: 'Estado de México', lat: 19.29, lon: -99.65 },
  { name: 'Coatzacoalcos', state: 'Veracruz', lat: 18.15, lon: -94.45 },
  { name: 'Veracruz', state: 'Veracruz', lat: 19.18, lon: -96.14 },
  { name: 'Loreto', state: 'Baja California Sur', lat: 26.01, lon: -111.35 },
  { name: 'Santa Rosalía', state: 'Baja California Sur', lat: 27.34, lon: -112.26 },
  { name: 'Mexicali', state: 'Baja California', lat: 32.65, lon: -115.46 },
  // Localidades y Puntos de Referencia en Guatemala (Red INSIVUMEH)
  { name: 'Ciudad de Guatemala', state: 'Guatemala', lat: 14.63, lon: -90.51 },
  { name: 'Quetzaltenango', state: 'Quetzaltenango, Guatemala', lat: 14.83, lon: -91.52 },
  { name: 'Huehuetenango', state: 'Huehuetenango, Guatemala', lat: 15.32, lon: -91.47 },
  { name: 'San Marcos', state: 'San Marcos, Guatemala', lat: 14.96, lon: -91.80 },
  { name: 'Retalhuleu', state: 'Retalhuleu, Guatemala', lat: 14.53, lon: -91.68 },
  { name: 'Escuintla', state: 'Escuintla, Guatemala', lat: 14.30, lon: -90.79 },
  { name: 'Cobán', state: 'Alta Verapaz, Guatemala', lat: 15.47, lon: -90.37 },
  { name: 'Puerto Barrios', state: 'Izabal, Guatemala', lat: 15.73, lon: -88.60 },
  { name: 'Flores', state: 'Petén, Guatemala', lat: 16.92, lon: -89.89 },
  // Localidades y Puntos de Referencia en El Salvador (Red MARN / SNET)
  { name: 'San Salvador', state: 'San Salvador, El Salvador', lat: 13.69, lon: -89.19 },
  { name: 'Santa Ana', state: 'Santa Ana, El Salvador', lat: 13.99, lon: -89.55 },
  { name: 'San Miguel', state: 'San Miguel, El Salvador', lat: 13.48, lon: -88.18 },
  { name: 'Usulután', state: 'Usulután, El Salvador', lat: 13.35, lon: -88.45 },
  { name: 'Ahuachapán', state: 'Ahuachapán, El Salvador', lat: 13.92, lon: -89.84 },
  { name: 'Sonsonate', state: 'Sonsonate, El Salvador', lat: 13.72, lon: -89.72 },
  { name: 'La Unión', state: 'La Unión, El Salvador', lat: 13.33, lon: -87.84 },
  { name: 'Chalatenango', state: 'Chalatenango, El Salvador', lat: 14.04, lon: -88.93 },
  { name: 'San Vicente', state: 'San Vicente, El Salvador', lat: 13.64, lon: -88.78 },
  // Localidades y Puntos de Referencia en Honduras (Red COPECO / UNAH)
  { name: 'Tegucigalpa', state: 'Francisco Morazán, Honduras', lat: 14.08, lon: -87.21 },
  { name: 'San Pedro Sula', state: 'Cortés, Honduras', lat: 15.50, lon: -88.02 },
  { name: 'La Ceiba', state: 'Atlántida, Honduras', lat: 15.78, lon: -86.79 },
  { name: 'Comayagua', state: 'Comayagua, Honduras', lat: 14.45, lon: -87.64 },
  { name: 'Choluteca', state: 'Choluteca, Honduras', lat: 13.30, lon: -87.19 },
  { name: 'Roatán', state: 'Islas de la Bahía, Honduras', lat: 16.32, lon: -86.53 },
  { name: 'Santa Bárbara', state: 'Santa Bárbara, Honduras', lat: 14.92, lon: -88.24 },
  { name: 'Copán Ruinas', state: 'Copán, Honduras', lat: 14.84, lon: -89.16 },
  { name: 'Juticalpa', state: 'Olancho, Honduras', lat: 14.66, lon: -86.22 },
  { name: 'Nacaome', state: 'Valle, Honduras', lat: 13.53, lon: -87.49 },
  { name: 'Trujillo', state: 'Colón, Honduras', lat: 15.92, lon: -85.95 },
];

export function resolveLocationName(lat: number, lon: number): string {
  // Cobertura de regiones en Japón (Tohoku, Iwate, Morioka, Miyagi, Sendai, Kanto)
  if (lon > 120 && lon < 150 && lat > 28 && lat < 48) {
    if (lat >= 39.2 && lat <= 40.4 && lon >= 140.7 && lon <= 142.2) return 'Morioka, Prefectura de Iwate (Japón)';
    if (lat >= 37.8 && lat < 39.2 && lon >= 140.6 && lon <= 142.1) return 'Sendai / Costa de Miyagi (Japón)';
    if (lat >= 36.6 && lat < 37.8 && lon >= 139.8 && lon <= 141.5) return 'Fukushima (Japón)';
    if (lat >= 35.0 && lat < 36.6 && lon >= 138.8 && lon <= 140.8) return 'Tokyo / Región de Kanto (Japón)';
    return 'Costa Este de Tohoku (Japón)';
  }

  // Cobertura de México (SSN/AM/BC/UV), Guatemala, El Salvador y Honduras. Fuera de ella se reporta como fuera de región.
  if (lat < 12.5 && lon > -87.0) {
    return 'Región de Nicaragua / Costa Rica (Fuera de cobertura)';
  }
  if (lat > 33.2) {
    return 'Frontera Norte / EE.UU. (Fuera de cobertura)';
  }
  if (lon < -119.5 || lon > -83.0) {
    return 'Océano / Fuera de territorio de cobertura';
  }

  let closestCity = REFERENCE_CITIES[0];
  let minDist = Infinity;
  for (const city of REFERENCE_CITIES) {
    const d = greatCircleKm(lat, lon, city.lat, city.lon);
    if (d < minDist) {
      minDist = d;
      closestCity = city;
    }
  }

  const distKm = Math.round(minDist);
  if (distKm <= 8) {
    return `Cerca de ${closestCity.name}, ${closestCity.state}`;
  }

  // Rumbo cardinal (N, NE, E, SE, S, SO, O, NO) desde la localidad hacia el epicentro
  const dLat = lat - closestCity.lat;
  const dLon = (lon - closestCity.lon) * Math.cos((closestCity.lat * Math.PI) / 180);
  const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI; // -180 a 180 (0 = Norte, 90 = Este)
  let dir = 'Sur';
  if (angle >= -22.5 && angle < 22.5) dir = 'Norte';
  else if (angle >= 22.5 && angle < 67.5) dir = 'Noreste';
  else if (angle >= 67.5 && angle < 112.5) dir = 'Este';
  else if (angle >= 112.5 && angle < 157.5) dir = 'Sureste';
  else if (angle >= 157.5 || angle < -157.5) dir = 'Sur';
  else if (angle >= -157.5 && angle < -112.5) dir = 'Suroeste';
  else if (angle >= -112.5 && angle < -67.5) dir = 'Oeste';
  else if (angle >= -67.5 && angle < -22.5) dir = 'Noroeste';

  // Distancia superior a 250 km de cualquier ciudad mexicana
  if (distKm > 250) {
    if (lat < closestCity.lat && (dir.includes('Sur') || dir.includes('Oeste'))) {
      return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state} (Océano Pacífico)`;
    }
    return `Fuera de región nacional (${distKm} km al ${dir} de la frontera mexicana)`;
  }

  return `${distKm} km al ${dir} de ${closestCity.name}, ${closestCity.state}`;
}
