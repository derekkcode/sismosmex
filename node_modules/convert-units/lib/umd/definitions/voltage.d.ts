import { Measure } from './../index.js';
export type VoltageUnits = VoltageSIUnits;
export type VoltageSystems = 'SI';
export type VoltageSIUnits = 'V' | 'μV' | 'mV' | 'kV' | 'MV';
declare const measure: Measure<VoltageSystems, VoltageUnits>;
export default measure;
