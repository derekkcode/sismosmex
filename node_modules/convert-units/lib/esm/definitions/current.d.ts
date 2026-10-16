import { Measure } from './../index.js';
export type CurrentUnits = CurrentSIUnits;
export type CurrentSystems = 'SI';
export type CurrentSIUnits = 'A' | 'μA' | 'mA' | 'kA' | 'MA';
declare const measure: Measure<CurrentSystems, CurrentUnits>;
export default measure;
