import { Measure } from './../index.js';
export type PartsPerUnits = PartsPerSIUnits;
export type PartsPerSystems = 'SI';
export type PartsPerSIUnits = 'ppm' | 'ppb' | 'ppt' | 'ppq';
declare const measure: Measure<PartsPerSystems, PartsPerUnits>;
export default measure;
