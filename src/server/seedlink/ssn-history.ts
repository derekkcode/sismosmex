/**
 * HISTORIAL DEL SERVICIO SISMOLÓGICO NACIONAL (SSN - UNAM)
 * Lee el RSS público de últimos sismos. Se usa como respaldo cuando MongoDB no carga
 * o cuando el usuario elige "cargar historial de SSN" en configuración.
 * El RSS no trae intensidad, así que estos eventos se marcan con intensityKnown = false.
 */

import type { DetectedEarthquake } from './detector';

const SSN_RSS_URL = 'http://www.ssn.unam.mx/rss/ultimos-sismos.xml';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;

let cache: { at: number; events: DetectedEarthquake[] } | null = null;

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&eacute;/g, 'é')
    .replace(/&oacute;/g, 'ó')
    .replace(/&aacute;/g, 'á')
    .replace(/&iacute;/g, 'í')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function readTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]) : '';
}

/**
 * Convierte un ítem del RSS en un evento. Fecha y hora del SSN están en hora de México (UTC-6, sin horario de verano desde 2022).
 */
function parseItem(block: string): DetectedEarthquake | null {
  const title = readTag(block, 'title');
  const description = readTag(block, 'description');
  const latStr = readTag(block, 'geo:lat');
  const lonStr = readTag(block, 'geo:long');

  const titleMatch = title.match(/^\s*(?:M\s*)?([\d.]+)\s*,\s*(.+)$/i);
  const fechaMatch = description.match(/Fecha:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  const profMatch = description.match(/Profundidad:\s*([\d.]+)/);

  const magnitude = titleMatch ? Number(titleMatch[1]) : NaN;
  const latitude = Number(latStr);
  const longitude = Number(lonStr);
  if (!fechaMatch || !Number.isFinite(magnitude) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const [, fecha, hora] = fechaMatch;
  const timeMs = new Date(`${fecha}T${hora}-06:00`).getTime();
  if (!Number.isFinite(timeMs)) return null;

  const location = titleMatch![2].replace(/\s+/g, ' ').trim();
  const depth = profMatch ? Number(profMatch[1]) : 0;
  const compactHora = hora.replace(/:/g, '');

  return {
    id: `eq-ssn-${fecha}-${compactHora}`,
    displayId: `SSN${compactHora.slice(-3)}`,
    time: new Date(timeMs).toISOString(),
    timeEpoch: timeMs,
    detectedAt: new Date(timeMs).toISOString(),
    latitude,
    longitude,
    depth: Number.isFinite(depth) ? depth : 0,
    magnitude,
    magnitudeType: 'M',
    location,
    maxPga: 0,
    maxIntensity: 0,
    intensityKnown: false,
    stationCount: 0,
    stations: [],
    isInter: false,
    category: 'ssn',
    source: 'SSN (Servicio Sismológico Nacional)',
    status: 'CONFIRMED',
    saved: true,
    isLocked: true,
  } as DetectedEarthquake;
}

export function parseSsnRss(xml: string): DetectedEarthquake[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const events: DetectedEarthquake[] = [];
  for (const item of items) {
    const eq = parseItem(item);
    if (eq) events.push(eq);
  }
  return events.sort((a, b) => b.timeEpoch - a.timeEpoch);
}

/**
 * Devuelve los sismos recientes del SSN (cacheados 5 min). Si el RSS no responde, devuelve la última copia válida o [].
 */
export async function getSsnHistory(): Promise<DetectedEarthquake[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.events;
  }
  try {
    const res = await fetch(SSN_RSS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseSsnRss(await res.text());
    cache = { at: Date.now(), events };
    return events;
  } catch (err) {
    console.warn('[SSN History] No se pudo leer el RSS del SSN:', (err as Error).message);
    return cache ? cache.events : [];
  }
}
