/**
 * GESTOR DE AUDIO SÍSMICO (ESTILO JQUAKE / EEW)
 * Controla tonos de alerta, anuncios de intensidad y avisos audibles
 */

import { SeismicNarratorClient } from './narrator-client.js';

export class SeismicAudioManager {
  constructor() {
    this.enabled = true;
    this.initialized = false;
    this.audioCache = new Map();
    this.lastVoiceIntensity = 0;
    this.alertaSismicaSound = 'meow';
    this.sirenActive = false;
    this.sirenCtx = null;
    this.sirenTimer = null;
    this.speechTimer = null;
    this.sirenNodes = null;
    this.narrator = new SeismicNarratorClient();
    this.audioFiles = [
      { id: 'alerta_sismica', url: '/desing/audio/meow.mp3', vol: 1.0 },
      { id: 'meow', url: '/desing/audio/meow.mp3', vol: 1.0 },
      { id: 'deteccion', url: '/desing/audio/deteccion.mp3', vol: 1.0 },
      { id: 'eqk_detected', url: '/desing/audio/eqk_detected.mp3', vol: 1.0 },
      { id: 'pip', url: '/desing/audio/pip.mp3', vol: 0.75 },
      { id: 'estimacion', url: '/desing/audio/estimacion.mp3', vol: 0.90 },
      { id: 'reporte', url: '/desing/audio/reporte.mp3', vol: 0.90 },
      { id: 'mm1', url: '/desing/audio/mm1.mp3', vol: 0.90 },
      { id: 'mm2', url: '/desing/audio/mm2.mp3', vol: 0.90 },
      { id: 'mm_3_4', url: '/desing/audio/mm_3_4.mp3', vol: 0.90 },
      { id: 'mm_5_6', url: '/desing/audio/mm_5_6.mp3', vol: 0.90 },
      { id: 'mm_7_8', url: '/desing/audio/mm_7_8.mp3', vol: 0.95 },
      { id: 'mm_9_10', url: '/desing/audio/mm_9_10.mp3', vol: 1.0 },
      { id: 'extreme', url: '/desing/audio/extreme.mp3', vol: 0.95 },
      { id: 'desconfirmacion', url: '/desing/audio/desconfirmacion.mp3', vol: 0.85 },
      { id: 'tsunami', url: '/desing/audio/tsunami.mp3', vol: 1.0 },
    ];

    this.tsunamiAudioElement = null;
    this.isTsunamiPlaying = false;

    this.initAudioElements();
  }

  initAudioElements() {
    this.audioFiles.forEach((item) => {
      try {
        const audio = new Audio(item.url);
        audio.preload = 'auto';
        audio.volume = item.vol;
        this.audioCache.set(item.id, audio);
      } catch (e) {
        console.warn('Error precargando audio:', item.id, e);
      }
    });

    // Desbloquear contexto de audio con la primera interacción del usuario
    const unlock = () => {
      this.initialized = true;
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  play(id) {
    if (!this.enabled) return;
    const audio = this.audioCache.get(id);
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Reproduce de manera robusta y garantizada el sonido de detección sísmica (deteccion.mp3 / eqk_detected.mp3).
   * Maneja restricciones de autoplay, caché y rutas fallback.
   */
  playDeteccion() {
    if (!this.enabled) return;
    try {
      let audio = this.audioCache.get('deteccion') || this.audioCache.get('eqk_detected');
      if (!audio) {
        audio = new Audio('/desing/audio/deteccion.mp3');
        audio.preload = 'auto';
        audio.volume = 1.0;
        this.audioCache.set('deteccion', audio);
      }
      audio.currentTime = 0;
      audio.volume = 1.0;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AudioManager] Reintentando reproduccion de deteccion.mp3:', err);
          const fallback = new Audio('/desing/audio/eqk_detected.mp3');
          fallback.volume = 1.0;
          fallback.play().catch(() => {});
        });
      }
    } catch (err) {
      console.warn('[AudioManager] Error al reproducir deteccion.mp3:', err);
    }
  }

  /**
   * Alerta inicial al declarar/detectar un sismo
   */
  playEarthquakeDeclared(magnitude = 5.0, intensity = 4) {
    if (!this.enabled) return;
    this.lastVoiceIntensity = 0;

    // Reproducir tono principal de detección sísmica (deteccion.mp3)
    this.playDeteccion();

    // Si es severo o extremo
    if (magnitude >= 7.5 || intensity >= 9) {
      setTimeout(() => {
        this.play('extreme');
      }, 700);
    }
  }

  /**
   * Alerta Sísmica oficial configurada
   */
  playAlertaSismica() {
    if (!this.enabled) return;
    this.playDeteccion();
  }

  /**
   * Reproduce el audio meow.mp3 UNA SOLA VEZ y solo durante la duración exacta del audio (loop = false).
   */
  playMeowOnce() {
    if (!this.enabled) return;
    try {
      let meowAudio = this.audioCache.get('meow');
      if (!meowAudio) {
        meowAudio = new Audio('/desing/audio/meow.mp3');
        meowAudio.preload = 'auto';
        this.audioCache.set('meow', meowAudio);
      }
      meowAudio.loop = false; // Se asegura de que se reproduzca solo una vez y solo la duración del audio
      meowAudio.currentTime = 0;
      meowAudio.volume = 1.0;
      const playPromise = meowAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AudioManager] Reproducción automática de meow.mp3 pendiente de interacción:', err);
        });
      }
    } catch (err) {
      console.warn('[AudioManager] Error al reproducir meow.mp3:', err);
    }
  }

  /**
   * Inicia el audio de Alerta Sísmica con meow.mp3 (reproduciendo una sola vez su duración natural)
   */
  startAlertaSismicaAudio(config = {}) {
    if (!this.enabled) return;
    this.stopAlertaSismicaAudio();
    this.sirenActive = true;
    this.playMeowOnce();
  }

  /**
   * Detiene el audio de la Alerta Sísmica (meow.mp3)
   */
  stopAlertaSismicaAudio() {
    this.sirenActive = false;

    // Detener meow.mp3
    const meowAudio = this.audioCache.get('meow');
    if (meowAudio) {
      try {
        meowAudio.pause();
        meowAudio.currentTime = 0;
      } catch (_) {}
    }

    if (this.speechTimer) {
      clearInterval(this.speechTimer);
      this.speechTimer = null;
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    if (this.sirenNodes) {
      try {
        const { osc, lfo, ampLfo, gainNode } = this.sirenNodes;
        if (this.sirenCtx && gainNode) {
          gainNode.gain.setTargetAtTime(0, this.sirenCtx.currentTime, 0.05);
        }
        setTimeout(() => {
          try {
            osc?.stop();
            lfo?.stop();
            ampLfo?.stop();
            osc?.disconnect();
            lfo?.disconnect();
            ampLfo?.disconnect();
            gainNode?.disconnect();
          } catch (_) {}
        }, 80);
      } catch (_) {}
      this.sirenNodes = null;
    }
  }

  /**
   * Se ejecuta cada vez que cambia la estimación de epicentro, magnitud o parámetros
   */
  playEstimationUpdate() {
    if (!this.enabled) return;
    this.play('estimacion');
  }

  /**
   * Se ejecuta cuando se emite un reporte oficial o reporte final
   */
  playReportIssued(isFinal = false) {
    if (!this.enabled) return;
    this.play('reporte');
  }

  /**
   * Alerta para intensidades destructivas extremas
   */
  playExtremeAlert() {
    if (!this.enabled) return;
    this.play('extreme');
  }

  /**
   * Desconfirmación o cancelación de evento sísmico
   */
  playDisconfirmation() {
    if (!this.enabled) return;
    this.play('desconfirmacion');
  }

  /**
   * Beep/Pip de actualización
   */
  playPip() {
    if (!this.enabled) return;
    this.play('pip');
  }

  /**
   * Anuncio de voz por escala de intensidad Mercalli alcanzada
   */
  playIntensityVoice(intVal) {
    if (!this.enabled) return;
    if (intVal <= this.lastVoiceIntensity) return;
    this.lastVoiceIntensity = intVal;

    if (intVal >= 9) {
      this.play('mm_9_10');
    } else if (intVal >= 7) {
      this.play('mm_7_8');
    } else if (intVal >= 5) {
      this.play('mm_5_6');
    } else if (intVal >= 3) {
      this.play('mm_3_4');
    } else if (intVal === 2) {
      this.play('mm2');
    } else if (intVal === 1) {
      this.play('mm1');
    }
  }

  /**
   * Reproduce el sonido de pulso por intensidad de estación según el Tier alcanzado
   */
  playStationIntensityPulseSound(tier, intensity) {
    if (!this.enabled) return;
    if (tier === 1) {
      if (intensity === 2) {
        this.play('mm2');
      } else {
        this.play('mm1');
      }
    } else if (tier === 2) {
      this.play('mm_3_4');
    } else if (tier === 3) {
      this.play('mm_5_6');
    } else if (tier === 4) {
      this.play('mm_7_8');
    } else if (tier >= 5) {
      this.play('mm_9_10');
    }
  }

  playPing() {
    if (!this.enabled) return;
    this.play('pip');
  }

  /**
   * Inicia la alarma sonora de Alerta de Tsunami en bucle continuo (tsunami.mp3)
   */
  startTsunamiAudio() {
    if (!this.enabled) return;
    try {
      if (!this.tsunamiAudioElement) {
        this.tsunamiAudioElement = new Audio('/desing/audio/tsunami.mp3');
        this.tsunamiAudioElement.loop = true;
        this.tsunamiAudioElement.volume = 1.0;
      }
      this.tsunamiAudioElement.currentTime = 0;
      const playPromise = this.tsunamiAudioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AudioManager] No se pudo reproducir tsunami.mp3 automáticamente:', err);
        });
      }
      this.isTsunamiPlaying = true;
    } catch (err) {
      console.warn('[AudioManager] Error iniciando audio tsunami:', err);
    }
  }

  /**
   * Detiene la alarma sonora de Tsunami
   */
  stopTsunamiAudio() {
    this.isTsunamiPlaying = false;
    if (this.tsunamiAudioElement) {
      try {
        this.tsunamiAudioElement.pause();
        this.tsunamiAudioElement.currentTime = 0;
      } catch (_) {}
    }
  }

  playTsunamiOnce() {
    if (!this.enabled) return;
    this.play('tsunami');
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled && this.isTsunamiPlaying) {
      this.stopTsunamiAudio();
    }
    return this.enabled;
  }

  // =========================================================================
  // INTEGRACIÓN CON NARRADOR DE VOZ METÓDICO (PLANTILLAS MÉXICO)
  // =========================================================================

  narrateTrigger(station) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.announceTrigger(station);
  }

  narrateEarlyAlert(options) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.announceEarlyAlert(options);
  }

  narrateBulletin(event) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.announceBulletin(event);
  }

  narrateIntensity(intensityName, regions) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.announceIntensity(intensityName, regions);
  }

  narrateTsunamiRisk(hasRisk, region) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.announceTsunamiRisk(hasRisk, region);
  }

  narratePhrase(phrase, options = {}) {
    if (!this.enabled || !this.narrator) return;
    this.narrator.speak(phrase, options);
  }
}
