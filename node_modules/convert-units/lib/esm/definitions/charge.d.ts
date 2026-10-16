import { Measure } from './../index.js';
export type ChargeUnits = ChargeSIUnits;
export type ChargeSystems = 'SI';
export type ChargeSIUnits = 'c' | 'mC' | 'μC' | 'nC' | 'pC';
declare const measure: Measure<ChargeSystems, ChargeUnits>;
export default measure;
