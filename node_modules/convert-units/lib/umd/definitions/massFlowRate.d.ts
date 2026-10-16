import { Measure } from './../index';
export type MassFlowRateUnits = MassFlowRateMetricUnits | MassFlowRateImperialUnits;
export type MassFlowRateSystems = 'metric' | 'imperial';
export type MassFlowRateMetricUnits = 'kg/s' | 'kg/min' | 'kg/h' | 'mt/h';
export type MassFlowRateImperialUnits = 'lb/s' | 'lb/h';
declare const measure: Measure<MassFlowRateSystems, MassFlowRateUnits>;
export default measure;
