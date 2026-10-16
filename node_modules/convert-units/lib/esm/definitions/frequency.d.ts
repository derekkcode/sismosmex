import { Measure } from './../index.js';
export type FrequencyUnits = FrequencySIUnits;
export type FrequencySystems = 'SI';
export type FrequencySIUnits = 'mHz' | 'Hz' | 'kHz' | 'MHz' | 'GHz' | 'THz' | 'rpm' | 'deg/s' | 'rad/s';
declare const measure: Measure<FrequencySystems, FrequencyUnits>;
export default measure;
