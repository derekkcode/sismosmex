import { Measure } from './../index.js';
export type EachUnits = EachMetricUnits;
export type EachSystems = 'metric';
export type EachMetricUnits = 'ea' | 'dz';
declare const measure: Measure<EachSystems, EachUnits>;
export default measure;
