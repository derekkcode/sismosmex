import { Measure } from './../index.js';
export type LengthUnits = LengthMetricUnits | LengthImperialUnits;
export type LengthSystems = 'metric' | 'imperial';
export type LengthMetricUnits = 'nm' | 'μm' | 'mm' | 'cm' | 'dm' | 'm' | 'km';
export type LengthImperialUnits = 'mil' | 'in' | 'yd' | 'ft-us' | 'ft' | 'fathom' | 'mi' | 'nMi';
declare const measure: Measure<LengthSystems, LengthUnits>;
export default measure;
