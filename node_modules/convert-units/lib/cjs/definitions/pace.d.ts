import { Measure } from './../index.js';
export type PaceUnits = PaceMetricUnits | PaceImperialUnits;
export type PaceSystems = 'metric' | 'imperial';
export type PaceMetricUnits = 'min/km' | 's/m';
export type PaceImperialUnits = 'min/mi' | 's/ft';
declare const measure: Measure<PaceSystems, PaceUnits>;
export default measure;
