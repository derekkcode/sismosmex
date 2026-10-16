import { Measure } from './../index.js';
export type AccelerationUnits = AccelerationMetricUnits;
export type AccelerationSystems = 'metric';
export type AccelerationMetricUnits = 'g-force' | 'm/s2' | 'g0';
declare const measure: Measure<AccelerationSystems, AccelerationUnits>;
export default measure;
