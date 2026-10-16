import { Measure } from './../index.js';
export type ForceUnits = ForceSIUnits;
export type ForceSystems = 'SI';
export type ForceSIUnits = 'N' | 'kN' | 'lbf' | 'kgf';
declare const measure: Measure<ForceSystems, ForceUnits>;
export default measure;
