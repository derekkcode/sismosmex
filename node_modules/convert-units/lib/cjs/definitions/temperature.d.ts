import { Measure } from './../index.js';
export type TemperatureUnits = TemperatureMetricUnits | TemperatureImperialUnits;
export type TemperatureSystems = 'metric' | 'imperial';
export type TemperatureMetricUnits = 'C' | 'K';
export type TemperatureImperialUnits = 'F' | 'R';
declare const measure: Measure<TemperatureSystems, TemperatureUnits>;
export default measure;
