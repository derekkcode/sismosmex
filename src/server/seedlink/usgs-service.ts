import * as https from 'https';
import * as http from 'http';
import { DetectedEarthquake } from './detector';

export interface USGSEarthquakeItem {
  id: string;
  displayId?: string;
  time: string;
  timeEpoch: number;
  detectedAt?: string;
  latitude: number;
  longitude: number;
  lat?: number;
  lon?: number;
  depth: number;
  magnitude: number;
  mag?: number;
  magnitudeType?: string;
  location: string;
  maxPga?: number;
  maxIntensity?: number;
  stationCount?: number;
  stations?: any[];
  isInter?: boolean;
  category?: string;
  source?: string;
  status: 'CONFIRMED' | 'PRELIMINARY';
  saved?: boolean;
  isLocked?: boolean;
}

/**
 * Servicio para consultar sismos en el continente Americano desde el USGS (United States Geological Survey).
 * Filtra automáticamente eventos con magnitud >= 5.5 dentro de América donde no hay estaciones locales.
 */
export class USGSEarthquakeService {
  private static instance: USGSEarthquakeService | null = null;
  private cachedEvents: DetectedEarthquake[] = [];
  private lastFetchTime = 0;
  private fetchIntervalMs = 5 * 60 * 1000; // 5 minutos

  private constructor() {}

  public static getInstance(): USGSEarthquakeService {
    if (!USGSEarthquakeService.instance) {
      USGSEarthquakeService.instance = new USGSEarthquakeService();
    }
    return USGSEarthquakeService.instance;
  }

  /**
   * Estima la intensidad Mercalli a partir de la magnitud y profundidad
   */
  public estimateIntensity(mag: number, depth: number = 10): number {
    if (mag >= 7.8) return 9;
    if (mag >= 7.0) return 8;
    if (mag >= 6.5) return 7;
    if (mag >= 5.8) return 6;
    if (mag >= 5.0) return 5;
    if (mag >= 4.2) return 4;
    if (mag >= 3.2) return 3;
    if (mag >= 2.2) return 2;
    return 1;
  }

  /**
   * Estima la aceleración PGA superficial (cm/s²) a partir de la magnitud
   */
  public estimatePga(mag: number): number {
    if (mag >= 7.5) return 45.0;
    if (mag >= 7.0) return 28.0;
    if (mag >= 6.5) return 18.5;
    if (mag >= 6.0) return 12.0;
    if (mag >= 5.5) return 6.5;
    return 2.0;
  }

  /**
   * Traduce o normaliza la descripción del lugar de USGS al español
   */
  public normalizeLocation(place: string): string {
    if (!place) return 'Región de América';

    let loc = place;
    // Reemplazos de direcciones en inglés
    loc = loc.replace(/\bof\b/gi, 'de');
    loc = loc.replace(/\bkm\s+([NEWSnews]{1,3})\s+of\b/gi, (_, dir) => {
      const d = dir.toUpperCase();
      const dirMap: Record<string, string> = {
        N: 'Norte',
        S: 'Sur',
        E: 'Este',
        W: 'Oeste',
        NE: 'Noreste',
        NW: 'Noroeste',
        SE: 'Sureste',
        SW: 'Suroeste',
        NNE: 'Nor-Noreste',
        NNW: 'Nor-Noroeste',
        ENE: 'Este-Noreste',
        WNW: 'Oeste-Noroeste',
        SSE: 'Sur-Sureste',
        SSW: 'Sur-Suroeste',
        ESE: 'Este-Sureste',
        WSW: 'Oeste-Suroeste',
      };
      return `km al ${dirMap[d] || d} de`;
    });
    loc = loc.replace(/\bnear\s+the\s+coast\s+of\b/gi, 'cerca de la costa de');
    loc = loc.replace(/\boffshore\b/gi, 'costa afuera de');
    loc = loc.replace(/\bCosta Rica\b/gi, 'Costa Rica');
    loc = loc.replace(/\bGuatemala\b/gi, 'Guatemala');
    loc = loc.replace(/\bNicaragua\b/gi, 'Nicaragua');
    loc = loc.replace(/\bHonduras\b/gi, 'Honduras');
    loc = loc.replace(/\bEl Salvador\b/gi, 'El Salvador');
    loc = loc.replace(/\bPanama\b/gi, 'Panamá');
    loc = loc.replace(/\bColombia\b/gi, 'Colombia');
    loc = loc.replace(/\bEcuador\b/gi, 'Ecuador');
    loc = loc.replace(/\bPeru\b/gi, 'Perú');
    loc = loc.replace(/\bChile\b/gi, 'Chile');
    loc = loc.replace(/\bArgentina\b/gi, 'Argentina');
    loc = loc.replace(/\bBolivia\b/gi, 'Bolivia');
    loc = loc.replace(/\bVenezuela\b/gi, 'Venezuela');
    loc = loc.replace(/\bDominican Republic\b/gi, 'República Dominicana');
    loc = loc.replace(/\bPuerto Rico\b/gi, 'Puerto Rico');
    loc = loc.replace(/\bCuba\b/gi, 'Cuba');
    loc = loc.replace(/\bHaiti\b/gi, 'Haití');
    loc = loc.replace(/\bMexico\b/gi, 'México');
    loc = loc.replace(/\bSouthern\b/gi, 'Sur de');
    loc = loc.replace(/\bNorthern\b/gi, 'Norte de');
    loc = loc.replace(/\bCentral\b/gi, 'Centro de');
    loc = loc.replace(/\bEastern\b/gi, 'Este de');
    loc = loc.replace(/\bWestern\b/gi, 'Oeste de');
    return loc;
  }

  /**
   * Realiza una petición HTTPS y retorna el JSON parseado
   */
  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(
        url,
        {
          headers: {
            'User-Agent': 'SismosMex-Realtime-Seismic-Monitor/2.0',
            Accept: 'application/json',
          },
          timeout: 12000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            this.fetchJson(res.headers.location).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            return;
          }
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout solicitando sismos al USGS'));
      });
    });
  }

  public isLocalNetworkCoverage(lat: number, lon: number, place: string): boolean {
    const p = (place || '').toLowerCase();
    if (
      p.includes('mexico') ||
      p.includes('méxico') ||
      p.includes('guatemala') ||
      p.includes('el salvador') ||
      p.includes('oaxaca') ||
      p.includes('chiapas') ||
      p.includes('guerrero') ||
      p.includes('michoacán') ||
      p.includes('michoacan') ||
      p.includes('jalisco') ||
      p.includes('colima')
    ) {
      return true;
    }
    // Bounding Box México, Guatemala y El Salvador (cubierto por redes sísmicas locales)
    if (lat >= 12.8 && lat <= 33.0 && lon >= -118.5 && lon <= -87.2) {
      return true;
    }
    return false;
  }

  /**
   * Obtiene sismos recientes de magnitud >= 5.5 en el continente Americano desde USGS
   */
  public async fetchRecentAmericanEarthquakes(minMag: number = 5.5): Promise<DetectedEarthquake[]> {
    const now = Date.now();
    if (this.cachedEvents.length > 0 && now - this.lastFetchTime < this.fetchIntervalMs) {
      return this.cachedEvents;
    }

    try {
      // Coordenadas del continente Americano: Latitud -60° a +70°, Longitud -170° a -30°
      // Solo sismos ocurridos recientemente (últimas 48 horas / a la fecha)
      const startTime = new Date(now - 48 * 3600 * 1000).toISOString();
      const queryUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=${minMag}&minlatitude=-60&maxlatitude=70&minlongitude=-170&maxlongitude=-30&starttime=${encodeURIComponent(startTime)}&orderby=time&limit=5`;
      console.log('[USGS Service] Consultando sismos recientes >= 5.5 en América desde USGS...');
      
      let geojson: any = null;
      try {
        geojson = await this.fetchJson(queryUrl);
      } catch (err) {
        // Fallback al feed de 4.5+ si query fdsnws falla
        console.warn('[USGS Service] Fallback a feed de USGS:', (err as Error).message);
        const fallbackUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
        geojson = await this.fetchJson(fallbackUrl);
      }

      if (!geojson || !Array.isArray(geojson.features)) {
        return this.cachedEvents;
      }

      const events: DetectedEarthquake[] = [];

      for (const feat of geojson.features) {
        if (!feat || !feat.properties || !feat.geometry) continue;
        const coords = feat.geometry.coordinates || [];
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        const depth = Math.max(1, Math.round(Number(coords[2] || 10)));
        const mag = Number(feat.properties.mag || 0);

        // Filtrar exclusivamente sismos en América y con magnitud >= 5.5
        if (mag < minMag) continue;
        if (lon < -170 || lon > -30 || lat < -60 || lat > 70) continue;

        const timeMs = Number(feat.properties.time || Date.now());
        // Filtrar sismos que no sean recientes (máximo 48h)
        if (timeMs < now - 48 * 3600 * 1000) continue;

        const rawPlace = String(feat.properties.place || 'América');

        // Omitir sismos del USGS dentro de México, Guatemala o El Salvador (éstos los procesan las estaciones locales)
        if (this.isLocalNetworkCoverage(lat, lon, rawPlace)) {
          continue;
        }

        const loc = this.normalizeLocation(rawPlace);
        const shortId = (feat.id || '').slice(-4).toUpperCase() || 'USGS';

        const eq: DetectedEarthquake = {
          id: `eq-usgs-${feat.id}`,
          displayId: shortId,
          time: new Date(timeMs).toISOString(),
          timeEpoch: timeMs,
          detectedAt: new Date(feat.properties.updated || timeMs).toISOString(),
          latitude: lat,
          longitude: lon,
          lat: lat,
          lon: lon,
          depth,
          magnitude: mag,
          mag: mag,
          magnitudeType: feat.properties.magType ? feat.properties.magType.toUpperCase() : 'M',
          location: loc,
          maxPga: this.estimatePga(mag),
          maxIntensity: this.estimateIntensity(mag, depth),
          stationCount: Number(feat.properties.numStations || 0),
          stations: [],
          isInter: true,
          category: 'inter',
          source: 'USGS (Sismo Internacional)',
          status: 'CONFIRMED',
          saved: true,
          isLocked: true,
        };

        events.push(eq);
      }

      this.cachedEvents = events;
      this.lastFetchTime = now;
      console.log(`[USGS Service] Se obtuvieron ${events.length} sismos >= ${minMag} en América desde USGS.`);
      return events;
    } catch (error) {
      console.error('[USGS Service] Error obteniendo sismos desde USGS:', error);
      return this.cachedEvents;
    }
  }
}
