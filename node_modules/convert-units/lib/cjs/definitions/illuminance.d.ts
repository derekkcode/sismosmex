import { Measure } from './../index.js';
export type IlluminanceUnits = IlluminanceMetricUnits | IlluminanceImperialUnits;
export type IlluminanceSystems = 'metric' | 'imperial';
export type IlluminanceMetricUnits = 'lx';
export type IlluminanceImperialUnits = 'ft-cd';
declare const measure: Measure<IlluminanceSystems, IlluminanceUnits>;
export default measure;
