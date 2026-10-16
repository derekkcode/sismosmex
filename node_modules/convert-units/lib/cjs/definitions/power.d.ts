import { Measure } from './../index.js';
export type PowerUnits = PowerMetricUnits | PowerImperialUnits;
export type PowerSystems = 'metric' | 'imperial';
export type PowerMetricUnits = 'W' | 'mW' | 'kW' | 'MW' | 'GW' | 'PS';
export type PowerImperialUnits = 'Btu/s' | 'ft-lb/s' | 'hp';
declare const measure: Measure<PowerSystems, PowerUnits>;
export default measure;
