import { Measure } from './../index.js';
export type TimeUnits = TimeSIUnits;
export type TimeSystems = 'SI';
export type TimeSIUnits = 'ns' | 'mu' | 'ms' | 's' | 'min' | 'h' | 'd' | 'week' | 'month' | 'year';
declare const measure: Measure<TimeSystems, TimeUnits>;
export default measure;
