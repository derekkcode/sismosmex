import { Measure } from './../index.js';
export type ReactiveEnergyUnits = ReactiveEnergySIUnits;
export type ReactiveEnergySystems = 'SI';
export type ReactiveEnergySIUnits = 'VARh' | 'mVARh' | 'kVARh' | 'MVARh' | 'GVARh';
declare const measure: Measure<ReactiveEnergySystems, ReactiveEnergyUnits>;
export default measure;
