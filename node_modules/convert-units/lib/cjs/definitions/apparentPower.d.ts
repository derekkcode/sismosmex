import { Measure } from './../index.js';
export type ApparentPowerUnits = ApparentPowerMetricUnits;
export type ApparentPowerSystems = 'SI';
export type ApparentPowerMetricUnits = 'VA' | 'mVA' | 'kVA' | 'MVA' | 'GVA';
declare const measure: Measure<ApparentPowerSystems, ApparentPowerUnits>;
export default measure;
