import { Measure } from './../index.js';
export type VolumeFlowRateUnits = VolumeFlowRateMetricUnits | VolumeFlowRateImperialUnits;
export type VolumeFlowRateSystems = 'metric' | 'imperial';
export type VolumeFlowRateMetricUnits = 'mm3/s' | 'cm3/s' | 'dm3/s' | 'dm3/min' | 'dm3/h' | 'dm3/d' | 'dm3/a' | 'ml/s' | 'cl/s' | 'dl/s' | 'l/s' | 'l/min' | 'l/h' | 'l/d' | 'l/a' | 'kl/s' | 'kl/min' | 'kl/h' | 'm3/s' | 'm3/min' | 'm3/h' | 'm3/d' | 'm3/a' | 'km3/s';
export type VolumeFlowRateImperialUnits = 'tsp/s' | 'Tbs/s' | 'in3/s' | 'in3/min' | 'in3/h' | 'fl-oz/s' | 'fl-oz/min' | 'fl-oz/h' | 'cup/s' | 'pnt/s' | 'pnt/min' | 'pnt/h' | 'qt/s' | 'gal/s' | 'gal/min' | 'gal/h' | 'ft3/s' | 'ft3/min' | 'ft3/h' | 'yd3/s' | 'yd3/min' | 'yd3/h';
declare const measure: Measure<VolumeFlowRateSystems, VolumeFlowRateUnits>;
export default measure;
