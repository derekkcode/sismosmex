import { Measure } from './../index.js';
export type EnergyUnits = EnergySIUnits | EnergyNutritionUnits;
export type EnergySystems = 'SI' | 'nutrition';
export type EnergySIUnits = 'Ws' | 'Wm' | 'Wh' | 'mWh' | 'kWh' | 'MWh' | 'GWh' | 'J' | 'kJ' | 'MJ' | 'GJ';
export type EnergyNutritionUnits = 'kcal' | 'cal';
declare const measure: Measure<EnergySystems, EnergyUnits>;
export default measure;
