/**
 * SERVICIO NARRADOR DE VOZ SÍSMICO (FISH AUDIO S2.1 PRO FREE + FALLBACK WEB SPEECH)
 * 
 * Genera locución estructurada, robótica, clara y metódica según las plantillas oficiales:
 * 1. Detección Inicial (Triggers de Ondas P / Estaciones Locales)
 * 2. Alerta Temprana (Aviso / Advertencia preventiva estilo SASMEX)
 * 3. Boletines de Sismo (Actualizaciones y Reportes automáticos estilo SSN)
 * 4. Reportes de Intensidad y Alertas Secundarias (Tsunami / Sin novedades)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TTSRequestOptions {
  text: string;
  referenceId?: string;
  format?: 'mp3' | 'wav';
}

/** Idiomas que usan Fish Audio. Cualquier otro idioma usa la voz del navegador en el cliente. */
export type NarratorLanguage = 'es' | 'en' | 'ja';

export class SeismicNarratorService {
  private static instance: SeismicNarratorService;
  private apiKey: string;
  private referenceIds: Record<NarratorLanguage, string>;
  private cacheDir: string;

  private constructor() {
    this.apiKey = process.env.FISH_AUDIO_API_KEY || 'sk-fish-Oj1lgqus9mBORHbp4J-6fNsF_gbzhV3FVAbSWNylvtM';
    this.referenceIds = {
      es: process.env.FISH_AUDIO_REFERENCE_ID || '02061e28525144daa9171e7536475bad',
      en: process.env.FISH_AUDIO_REFERENCE_ID_EN || '906b8b47c30d4ba2a7f1287773e8a3ed',
      ja: process.env.FISH_AUDIO_REFERENCE_ID_JA || 'cf3ff5142d35408bb66a9965b3d7d04e',
    };
    this.cacheDir = path.join(process.cwd(), 'data', 'narrator_cache');

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (_) {}
  }

  public static getInstance(): SeismicNarratorService {
    if (!SeismicNarratorService.instance) {
      SeismicNarratorService.instance = new SeismicNarratorService();
    }
    return SeismicNarratorService.instance;
  }

  public getReferenceIds(): Record<NarratorLanguage, string> {
    return { ...this.referenceIds };
  }

  /**
   * Genera el audio TTS con Fish Audio API o devuelve buffer cacheado.
   * Si la API falla (ej. error 402 créditos agotados o timeout), retorna null
   * para que el frontend use síntesis de voz Web Speech API.
   */
  public async synthesizeSpeech(text: string, language: string = 'es'): Promise<{ audioBuffer: Buffer | null; mimeType: string; cached: boolean }> {
    const cleanText = text.trim();
    if (!cleanText) {
      return { audioBuffer: null, mimeType: 'audio/mpeg', cached: false };
    }

    const referenceId = this.referenceIds[language as NarratorLanguage];
    if (!referenceId) {
      return { audioBuffer: null, mimeType: 'audio/mpeg', cached: false };
    }

    const hash = crypto.createHash('md5').update(`${cleanText}_${referenceId}`).digest('hex');
    const cachedFilePath = path.join(this.cacheDir, `${hash}.mp3`);

    // 1. Revisar caché local en disco
    if (fs.existsSync(cachedFilePath)) {
      try {
        const audioBuffer = fs.readFileSync(cachedFilePath);
        return { audioBuffer, mimeType: 'audio/mpeg', cached: true };
      } catch (_) {}
    }

    // 2. Si no hay API key configurada, salir para fallback
    if (!this.apiKey) {
      return { audioBuffer: null, mimeType: 'audio/mpeg', cached: false };
    }

    // 3. Llamar a Fish Audio API
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      const resp = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'model': 's2.1-pro-free',
        },
        body: JSON.stringify({
          text: cleanText,
          reference_id: referenceId,
          format: 'mp3',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        console.warn(`[SeismicNarrator] Fish Audio API error (${resp.status}): ${errorText}. Se usará fallback Web Speech.`);
        return { audioBuffer: null, mimeType: 'audio/mpeg', cached: false };
      }

      const arrayBuf = await resp.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuf);

      // Guardar en caché
      try {
        fs.writeFileSync(cachedFilePath, audioBuffer);
      } catch (_) {}

      return { audioBuffer, mimeType: 'audio/mpeg', cached: false };
    } catch (err: any) {
      console.warn(`[SeismicNarrator] Excepción en llamada Fish Audio: ${err.message}. Se usará fallback.`);
      return { audioBuffer: null, mimeType: 'audio/mpeg', cached: false };
    }
  }

  // =========================================================================
  // GENERADORES DE PLANTILLAS OFICIALES DE NARRACIÓN (MÉXICO)
  // =========================================================================

  /**
   * 1. Detección Inicial (Triggers de Ondas P / Estaciones Locales)
   */
  public generateInitialTriggerPhrase(stationName: string, stateName: string, pga?: number): string {
    const region = stateName || stationName || 'Pacífico Sur';
    if (region.toLowerCase().includes('guerrero')) {
      return 'Costa de Guerrero: vibración detectada.';
    }
    if (region.toLowerCase().includes('oaxaca')) {
      return 'Oaxaca, región costera: movimiento detectado en estación remota.';
    }
    if (region.toLowerCase().includes('michoacán') || region.toLowerCase().includes('michoacan')) {
      return 'Michoacán: señal sísmica registrada en la red local.';
    }
    if (region.toLowerCase().includes('chiapas')) {
      return 'Chiapas: actividad sísmica detectada en estación de monitoreo.';
    }
    if (region.toLowerCase().includes('jalisco') || region.toLowerCase().includes('colima')) {
      return `${region}: vibración detectada en sensores costeros.`;
    }
    return `Aviso: Actividad inusual detectada en el sector ${region}.`;
  }

  /**
   * 2. Alerta Temprana (Advertencias Inmediatas / Estilo SASMEX)
   */
  public generateEarlyAlertPhrase(zones: string[] | string, secondsToCapital?: number): string {
    const zonesStr = Array.isArray(zones) ? zones.join(', ') : zones;
    if (secondsToCapital && secondsToCapital > 0) {
      const secWords = this.numberToWords(secondsToCapital);
      return `Alerta sísmica activada. Zonas en prevención: ${zonesStr}. Tiempo estimado para la llegada de ondas principales a la región centro: ${secWords} segundos.`;
    }
    return `Aviso de alerta sísmica. Zonas en prevención: ${zonesStr}. Prepárense ante la llegada de movimiento fuerte. Mantenga la calma y ubíquese en zona de seguridad.`;
  }

  /**
   * 3. Boletines de Sismo (Actualizaciones Automáticas / Estilo SSN)
   */
  public generateBulletinPhrase(ev: {
    location: string;
    magnitude: number;
    depth?: number;
    reportNumber?: number;
    isUpdate?: boolean;
    date?: Date;
  }): string {
    const now = ev.date || new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timePhrase = `A las ${this.numberToWords(hours)} horas con ${this.numberToWords(minutes)} minutos`;
    const magStr = Number(ev.magnitude || 0).toFixed(1);
    const depthStr = Math.round(ev.depth || 10);

    if (ev.isUpdate && (ev.reportNumber || 1) > 1) {
      return `Actualización de sismo. Epicentro recalculado: ${ev.location}. Magnitud ajustada: ${magStr}. Profundidad focal: ${depthStr} kilómetros.`;
    }

    return `Información sísmica. ${timePhrase}, se registró un sismo. Epicentro: ${ev.location}. Profundidad focal: ${depthStr} kilómetros. Magnitud estimada: ${magStr}.`;
  }

  /**
   * 4. Reporte de Sismo Internacional en el Continente Americano
   */
  public generateInternationalEarthquakePhrase(ev: {
    location: string;
    magnitude: number;
    depth?: number;
    source?: string;
  }): string {
    const magStr = Number(ev.magnitude || 0).toFixed(1);
    const depthStr = Math.round(ev.depth || 10);
    const place = ev.location || 'el continente americano';
    
    return `Boletín internacional. Se registró un sismo en el continente americano. Ubicación: ${place}. Magnitud: ${magStr}. Profundidad: ${depthStr} kilómetros. Sin riesgo para la red nacional.`;
  }

  /**
   * 5. Reportes de Intensidad y Alertas Secundarias
   */
  public generateIntensityReportPhrase(intensityName: string, regions: string[]): string {
    if (!regions || regions.length === 0) {
      return `Aviso de intensidad. Se observó intensidad ${intensityName.toLowerCase()}.`;
    }
    return `Aviso de intensidad. Se observó intensidad ${intensityName.toLowerCase()} en ${regions.join(', ')}.`;
  }

  public generateTsunamiNoticePhrase(hasRisk: boolean, regionName: string = 'Pacífico central'): string {
    if (hasRisk) {
      return `Atención: Se ha emitido un aviso preventivo de maremoto para las costas del ${regionName}.`;
    }
    return `Este sismo no representa riesgo de tsunami para el litoral mexicano.`;
  }

  private numberToWords(n: number): string {
    const units = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
      'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
      'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta',
      'treinta y uno', 'treinta y dos', 'treinta y tres', 'treinta y cuatro', 'treinta y cinco', 'treinta y seis', 'treinta y siete', 'treinta y ocho', 'treinta y nueve', 'cuarenta',
      'cuarenta y cinco', 'cincuenta', 'cincuenta y cinco', 'sesenta'
    ];
    if (n >= 0 && n < units.length && units[n]) {
      return units[n];
    }
    return String(n);
  }
}
