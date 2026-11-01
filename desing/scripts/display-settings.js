// Preferencias de visualización: escala de intensidad y zoom automático.
// Se guardan en localStorage y emiten 'sismosmex:displaysettingschange' al cambiar.

const INTENSITY_SCALE_KEY = 'sismosmex_intensity_scale';
const ROMAN_NUMERALS_KEY = 'sismosmex_roman_numerals';
const AUTO_ZOOM_KEY = 'sismosmex_auto_zoom';
const HISTORY_SOURCE_KEY = 'sismosmex_history_source';
export const DISPLAY_SETTINGS_EVENT = 'sismosmex:displaysettingschange';

export const INTENSITY_SCALES = ['mercalli', 'shindo'];
export const HISTORY_SOURCES = ['monitor', 'ssn'];

// Equivalencia aproximada MMI -> Shindo (JMA). Es orientativa, no una conversión oficial.
const MMI_TO_SHINDO = {
  1: '0', 2: '0', 3: '1', 4: '2', 5: '3', 6: '4', 7: '5-', 8: '5+', 9: '6-', 10: '6+',
};

const MMI_ROMAN = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function getIntensityScale() {
  try {
    const saved = localStorage.getItem(INTENSITY_SCALE_KEY);
    return INTENSITY_SCALES.includes(saved) ? saved : 'mercalli';
  } catch (_) {
    return 'mercalli';
  }
}

export function setIntensityScale(scale) {
  const value = INTENSITY_SCALES.includes(scale) ? scale : 'mercalli';
  try {
    localStorage.setItem(INTENSITY_SCALE_KEY, value);
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(DISPLAY_SETTINGS_EVENT, { detail: { intensityScale: value } }));
  return value;
}

/** Solo aplica a Mercalli: true = I, II, III…; false = 1, 2, 3… (por defecto romanos). */
export function getRomanNumeralsEnabled() {
  try {
    return localStorage.getItem(ROMAN_NUMERALS_KEY) !== 'false';
  } catch (_) {
    return true;
  }
}

export function setRomanNumeralsEnabled(enabled) {
  const value = Boolean(enabled);
  try {
    localStorage.setItem(ROMAN_NUMERALS_KEY, String(value));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(DISPLAY_SETTINGS_EVENT, { detail: { romanNumerals: value } }));
  return value;
}

/** Convierte una intensidad (valor continuo o entero) a la etiqueta de la escala activa. */
export function formatIntensity(mmi) {
  const value = Math.max(1, Math.min(10, Math.round(Number(mmi) || 0)));
  if (getIntensityScale() === 'shindo') {
    return MMI_TO_SHINDO[value] || '0';
  }
  if (!getRomanNumeralsEnabled()) {
    return String(value);
  }
  return MMI_ROMAN[value] || '—';
}

export function getAutoZoomEnabled() {
  try {
    return localStorage.getItem(AUTO_ZOOM_KEY) !== 'false';
  } catch (_) {
    return true;
  }
}

export function setAutoZoomEnabled(enabled) {
  const value = Boolean(enabled);
  try {
    localStorage.setItem(AUTO_ZOOM_KEY, String(value));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(DISPLAY_SETTINGS_EVENT, { detail: { autoZoom: value } }));
  return value;
}

/** 'monitor' = historial de MongoDB (con respaldo SSN); 'ssn' = solo catálogo del SSN. */
export function getHistorySource() {
  try {
    const saved = localStorage.getItem(HISTORY_SOURCE_KEY);
    return HISTORY_SOURCES.includes(saved) ? saved : 'monitor';
  } catch (_) {
    return 'monitor';
  }
}

export function setHistorySource(source) {
  const value = HISTORY_SOURCES.includes(source) ? source : 'monitor';
  try {
    localStorage.setItem(HISTORY_SOURCE_KEY, value);
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(DISPLAY_SETTINGS_EVENT, { detail: { historySource: value } }));
  return value;
}
