/**
 * CLIENTE NARRADOR DE VOZ PARA MONITOR SÍSMICO (MÉXICO)
 * 
 * Gestiona la locución estructurada, robótica y metódica:
 * - 1. Detección Inicial (Triggers de Ondas P / Estaciones Locales)
 * - 2. Alerta Temprana (Avisos urgentes preventivos estilo SASMEX)
 * - 3. Boletines de Sismo (Actualizaciones y reportes automáticos estilo SSN)
 * - 4. Reportes de Intensidad y Alertas Secundarias (Tsunami / Sin novedades)
 * 
 * Estrategia de Audio:
 * - Prioridad 1: Fish Audio S2.1 Pro Free vía endpoint backend /api/narrator/speak (cacheado)
 * - Prioridad 2: Síntesis robótica nativa Web Speech API (Voz en español neutra/robótica)
 */

export class SeismicNarratorClient {
  constructor(options = {}) {
    this.enabled = true;
    this.volume = 1.0;
    this.isSpeaking = false;
    this.queue = [];
    this.audioElement = new Audio();
    this.currentVoice = null;
    this.onStateChange = options.onStateChange || (() => {});
    this.onSpeakingChange = options.onSpeakingChange || (() => {});

    // Historial para no repetir la misma frase consecutiva en bucle
    this.lastSpokenKey = '';
    this.lastSpokenTimestamp = 0;

    // Cargar preferencia guardada en localStorage
    try {
      const saved = localStorage.getItem('sismosmex_narrator_enabled');
      if (saved !== null) {
        this.enabled = saved === 'true';
      }
    } catch (_) {}

    this.initWebSpeech();
  }

  initWebSpeech() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const findVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      // Buscar voz mexicana, española o neutra
      this.currentVoice = voices.find(v => v.lang === 'es-MX') ||
                          voices.find(v => v.lang.startsWith('es-')) ||
                          voices.find(v => v.lang.includes('es')) ||
                          null;
    };
    findVoice();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = findVoice;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('sismosmex_narrator_enabled', String(this.enabled));
    } catch (_) {}
    if (!this.enabled) {
      this.stop();
    }
    this.onStateChange(this.enabled);
    return this.enabled;
  }

  setEnabled(val) {
    this.enabled = Boolean(val);
    try {
      localStorage.setItem('sismosmex_narrator_enabled', String(this.enabled));
    } catch (_) {}
    if (!this.enabled) {
      this.stop();
    }
    this.onStateChange(this.enabled);
  }

  stop() {
    this.queue = [];
    const wasSpeaking = this.isSpeaking;
    this.isSpeaking = false;
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    if (wasSpeaking) {
      try { this.onSpeakingChange(false); } catch (_) {}
    }
  }

  /**
   * Encola o reproduce una frase de narración
   */
  speak(text, options = {}) {
    if (!this.enabled || !text) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    const dedupeKey = `${cleanText}_${options.category || 'general'}`;
    const now = Date.now();
    // Evitar disparar exactamente la misma frase dentro de los últimos 8 segundos
    if (this.lastSpokenKey === dedupeKey && (now - this.lastSpokenTimestamp) < 8000) {
      return;
    }

    this.lastSpokenKey = dedupeKey;
    this.lastSpokenTimestamp = now;

    // Si es urgente (ej. Alerta Sísmica), interrumpir y reproducir de inmediato
    if (options.urgent) {
      this.stop();
      this.queue = [{ text: cleanText, options }];
      this.processQueue();
      return;
    }

    // Agregar a la cola (máximo 4 pendientes para no acumular frases desactualizadas)
    if (this.queue.length >= 4) {
      this.queue.shift();
    }
    this.queue.push({ text: cleanText, options });

    if (!this.isSpeaking) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.queue.length === 0) {
      const wasSpeaking = this.isSpeaking;
      this.isSpeaking = false;
      if (wasSpeaking) {
        try { this.onSpeakingChange(false); } catch (_) {}
      }
      return;
    }

    if (!this.isSpeaking) {
      this.isSpeaking = true;
      try { this.onSpeakingChange(true); } catch (_) {}
    }
    const item = this.queue.shift();

    try {
      await this.speakSingleItem(item.text, item.options);
    } catch (err) {
      console.warn('[SeismicNarrator] Error en locución:', err);
    } finally {
      // Pequeña pausa de 350ms entre frases para mantener cadencia robótica y clara
      setTimeout(() => {
        this.processQueue();
      }, 350);
    }
  }

  speakSingleItem(text, options = {}) {
    return new Promise((resolve) => {
      // 1. Intentar Fish Audio API a través de nuestro endpoint server
      fetch('/api/narrator/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then(async (resp) => {
          const contentType = resp.headers.get('content-type') || '';
          if (resp.ok && contentType.includes('audio')) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            this.audioElement.src = url;
            this.audioElement.volume = this.volume;
            this.audioElement.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            this.audioElement.onerror = () => {
              URL.revokeObjectURL(url);
              this.fallbackWebSpeech(text, resolve);
            };
            this.audioElement.play().catch(() => {
              this.fallbackWebSpeech(text, resolve);
            });
          } else {
            // Fish Audio no disponible o error de balance -> Fallback a Web Speech
            this.fallbackWebSpeech(text, resolve);
          }
        })
        .catch(() => {
          this.fallbackWebSpeech(text, resolve);
        });
    });
  }

  /**
   * Síntesis robótica de voz nativa (Web Speech API) con entonación metódica y pausada
   */
  fallbackWebSpeech(text, callback) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (typeof callback === 'function') callback();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      if (this.currentVoice) {
        utterance.voice = this.currentVoice;
      }
      utterance.rate = 0.95; // Cadencia robótica clara y metódica
      utterance.pitch = 0.95; // Tono serio y profesional
      utterance.volume = this.volume;

      utterance.onend = () => {
        if (typeof callback === 'function') callback();
      };
      utterance.onerror = () => {
        if (typeof callback === 'function') callback();
      };

      window.speechSynthesis.speak(utterance);
    } catch (_) {
      if (typeof callback === 'function') callback();
    }
  }

  // =========================================================================
  // PLANTILLAS ESPECÍFICAS DE NARRACIÓN SÍSMICA (MÉXICO)
  // =========================================================================

  /**
   * 1. Detección Inicial (Triggers de Ondas P / Estaciones Locales)
   */
  announceTrigger(station) {
    if (!this.enabled || !station) return;

    // Ignorar por completo todas las aceleraciones y triggers de Guatemala y El Salvador
    const net = (station.network || '').trim().toUpperCase();
    const code = (station.code || station.id || '').trim().toUpperCase();
    const fullCode = (station.fullCode || '').trim().toUpperCase();
    const state = (station.state || '').toLowerCase();
    const site = (station.site || station.name || '').toLowerCase();
    const netName = (station.networkName || '').toLowerCase();
    const source = (station.source || station.serverSource || '').toLowerCase();

    const isGt = net === 'GI' ||
                 code.startsWith('GI.') ||
                 fullCode.startsWith('GI.') ||
                 state.includes('guatemala') ||
                 site.includes('guatemala') ||
                 netName.includes('guatemala') ||
                 netName.includes('insivumeh') ||
                 source.includes('insivumeh');

    const isSv = net === 'SV' ||
                 code.startsWith('SV.') ||
                 fullCode.startsWith('SV.') ||
                 state.includes('salvador') ||
                 site.includes('salvador') ||
                 netName.includes('salvador') ||
                 netName.includes('marn') ||
                 source.includes('salvador') ||
                 source.includes('marn');

    if (isGt || isSv) {
      return;
    }

    const name = station.site || station.name || station.code || '';
    const full = `${state} ${name}`.toLowerCase();

    let phrase = '';
    if (full.includes('guerrero')) {
      phrase = 'Costa de Guerrero: vibración detectada.';
    } else if (full.includes('oaxaca')) {
      phrase = 'Oaxaca, región costera: movimiento detectado en estación remota.';
    } else if (full.includes('michoac')) {
      phrase = 'Michoacán: señal sísmica registrada en la red local.';
    } else if (full.includes('chiapas')) {
      phrase = 'Chiapas: actividad sísmica detectada en estación de monitoreo.';
    } else if (full.includes('jalisco') || full.includes('colima')) {
      phrase = 'Colima y Jalisco: vibración detectada en sensores costeros.';
    } else if (full.includes('puebla') || full.includes('morelos')) {
      phrase = 'Región centro: vibración detectada en la red local.';
    } else {
      const regionLabel = station.state || name || 'costa del Pacífico';
      phrase = `Aviso: Actividad inusual detectada en el sector ${regionLabel}.`;
    }

    this.speak(phrase, { category: 'trigger', urgent: false });
  }

  /**
   * 2. Alerta Temprana (Advertencias Inmediatas / Estilo SASMEX)
   */
  announceEarlyAlert(options = {}) {
    if (!this.enabled) return;
    const zonas = options.estados || 'Guerrero, Michoacán y Valle de México';
    const seconds = options.seconds;

    let phrase = '';
    if (seconds && seconds > 0) {
      const secWord = this.numberToWord(seconds);
      phrase = `Alerta sísmica activada. Zonas en prevención: ${zonas}. Tiempo estimado para la llegada de ondas principales a la región centro: ${secWord} segundos.`;
    } else {
      phrase = `Aviso de alerta sísmica. Zonas en prevención: ${zonas}. Prepárense ante la llegada de movimiento fuerte. Mantenga la calma y ubíquese en zona de seguridad.`;
    }

    this.speak(phrase, { category: 'alerta_temprana', urgent: true });
  }

  /**
   * 3. Boletines de Sismo (Actualizaciones Automáticas / Estilo SSN / Internacionales)
   */
  announceBulletin(event) {
    if (!this.enabled || !event) return;

    const isInter = Boolean(
      event.isInter ||
      event.category === 'inter' ||
      (event.source && (event.source.toLowerCase().includes('inter') || event.source.toLowerCase().includes('usgs')))
    );

    if (isInter) {
      this.announceInternationalEarthquake(event);
      return;
    }

    const mag = Number(event.magnitude || event.mag || 0).toFixed(1);
    const loc = event.location || 'México';
    const depth = Math.round(event.depth || 15);
    const reportNum = event.reportNumber || 1;
    const isUpdate = reportNum > 1;

    let phrase = '';
    if (isUpdate) {
      phrase = `Actualización de sismo. Epicentro recalculado: ${loc}. Magnitud ajustada: ${mag}. Profundidad focal: ${depth} kilómetros.`;
    } else {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const timeStr = `A las ${this.numberToWord(h)} horas con ${this.numberToWord(m)} minutos`;
      phrase = `Información sísmica. ${timeStr}, se registró un sismo. Epicentro: ${loc}. Profundidad focal: ${depth} kilómetros. Magnitud estimada: ${mag}.`;
    }

    this.speak(phrase, { category: 'boletin', urgent: false });
  }

  /**
   * 3.1 Reporte de Sismo Internacional en el Continente Americano
   */
  announceInternationalEarthquake(event) {
    if (!this.enabled || !event) return;
    const mag = Number(event.magnitude || event.mag || 0).toFixed(1);
    const loc = event.location || 'el continente americano';
    const depth = Math.round(event.depth || 10);

    const phrase = `Boletín internacional. Se registró un sismo en el continente americano. Ubicación: ${loc}. Magnitud: ${mag}. Profundidad focal: ${depth} kilómetros. Sin riesgo para la red nacional.`;
    this.speak(phrase, { category: 'boletin_inter', urgent: false });
  }

  /**
   * 4. Reportes de Intensidad y Alertas Secundarias
   */
  announceIntensity(intensityName, regions = []) {
    if (!this.enabled) return;
    let phrase = '';
    if (regions && regions.length > 0) {
      phrase = `Aviso de intensidad. Se observó intensidad ${intensityName.toLowerCase()} en ${regions.join(', ')}.`;
    } else {
      phrase = `Aviso de intensidad. Se observó intensidad ${intensityName.toLowerCase()}.`;
    }
    this.speak(phrase, { category: 'intensidad', urgent: false });
  }

  announceTsunamiRisk(hasRisk, region = 'costas del Pacífico central') {
    if (!this.enabled) return;
    let phrase = '';
    if (hasRisk) {
      phrase = `Atención: Se ha emitido un aviso preventivo de maremoto para las ${region}.`;
    } else {
      phrase = `Este sismo no representa riesgo de tsunami para el litoral mexicano.`;
    }
    this.speak(phrase, { category: 'tsunami', urgent: true });
  }

  announceNoNews() {
    if (!this.enabled) return;
    const phrase = 'Actualización del sistema de monitoreo sísmico. Sin novedades reportadas en las últimas dos horas.';
    this.speak(phrase, { category: 'no_news', urgent: false });
  }

  numberToWord(n) {
    const words = [
      'cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
      'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
      'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta',
      'treinta y uno', 'treinta y dos', 'treinta y tres', 'treinta y cuatro', 'treinta y cinco', 'treinta y seis', 'treinta y siete', 'treinta y ocho', 'treinta y nueve', 'cuarenta',
      'cuarenta y uno', 'cuarenta y dos', 'cuarenta y tres', 'cuarenta y cuatro', 'cuarenta y cinco', 'cincuenta', 'cincuenta y cinco', 'sesenta'
    ];
    if (n >= 0 && n < words.length && words[n]) {
      return words[n];
    }
    return String(n);
  }
}
