import { Measure } from './../index.js';
export type SpeedUnits = SpeedMetricUnits | SpeedImperialUnits;
export type SpeedSystems = 'metric' | 'imperial';
export type SpeedMetricUnits = 'm/s' | 'km/h' | 'mm/h';
export type SpeedImperialUnits = 'mph' | 'knot' | 'ft/s' | 'ft/min' | 'in/h';
declare const measure: Measure<SpeedSystems, SpeedUnits>;
export default measure;
