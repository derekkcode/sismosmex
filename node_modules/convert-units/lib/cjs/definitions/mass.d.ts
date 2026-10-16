import { Measure } from './../index.js';
export type MassUnits = MassMetricUnits | MassImperialUnits;
export type MassSystems = 'metric' | 'imperial';
export type MassMetricUnits = 'mcg' | 'mg' | 'g' | 'kg' | 'mt';
export type MassImperialUnits = 'oz' | 'lb' | 'st' | 't';
declare const measure: Measure<MassSystems, MassUnits>;
export default measure;
