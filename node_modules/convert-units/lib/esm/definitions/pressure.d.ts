import { Measure } from './../index.js';
export type PressureUnits = PressureMetricUnits | PressureImperialUnits;
export type PressureSystems = 'metric' | 'imperial';
export type PressureMetricUnits = 'Pa' | 'kPa' | 'MPa' | 'hPa' | 'mbar' | 'bar' | 'torr' | 'mH2O' | 'mmHg';
export type PressureImperialUnits = 'psi' | 'ksi' | 'inHg';
declare const measure: Measure<PressureSystems, PressureUnits>;
export default measure;
