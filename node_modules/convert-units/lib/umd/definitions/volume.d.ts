import { Measure } from './../index.js';
export type VolumeUnits = VolumeMetricUnits | VolumeImperialUnits;
export type VolumeSystems = 'metric' | 'imperial';
export type VolumeMetricUnits = 'mm3' | 'cm3' | 'dm3' | 'ml' | 'l' | 'kl' | 'Ml' | 'Gl' | 'm3' | 'km3' | 'cl' | 'dl' | 'krm' | 'tsk' | 'msk' | 'kkp' | 'glas' | 'kanna';
export type VolumeImperialUnits = 'tsp' | 'Tbs' | 'in3' | 'fl-oz' | 'cup' | 'pnt' | 'qt' | 'gal' | 'ft3' | 'yd3';
declare const measure: Measure<VolumeSystems, VolumeUnits>;
export default measure;
