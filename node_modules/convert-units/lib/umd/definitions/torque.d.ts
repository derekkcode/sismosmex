import { Measure } from './../index.js';
export type TorqueUnits = TorqueMetricUnits | TorqueImperialUnits;
export type TorqueSystems = 'metric' | 'imperial';
export type TorqueMetricUnits = 'Nm' | 'cNm' | 'dNm' | 'kgm' | 'kg-cm';
export type TorqueImperialUnits = 'lbf-ft' | 'lbf-in' | 'ozf-in';
declare const measure: Measure<TorqueSystems, TorqueUnits>;
export default measure;
