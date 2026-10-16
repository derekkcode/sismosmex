import { Measure } from './../index.js';
export type AreaUnits = AreaMetricUnits | AreaImperialUnits;
export type AreaSystems = 'metric' | 'imperial';
export type AreaMetricUnits = 'nm2' | 'μm2' | 'mm2' | 'cm2' | 'dm2' | 'm2' | 'a' | 'ha' | 'km2';
export type AreaImperialUnits = 'in2' | 'yd2' | 'ft2' | 'ac' | 'mi2';
declare const measure: Measure<AreaSystems, AreaUnits>;
export default measure;
