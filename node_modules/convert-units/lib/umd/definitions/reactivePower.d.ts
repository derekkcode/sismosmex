import { Measure } from './../index.js';
export type ReactivePowerUnits = ReactivePowerSIUnits;
export type ReactivePowerSystems = 'SI';
export type ReactivePowerSIUnits = 'VAR' | 'mVAR' | 'kVAR' | 'MVAR' | 'GVAR';
declare const measure: Measure<ReactivePowerSystems, ReactivePowerUnits>;
export default measure;
