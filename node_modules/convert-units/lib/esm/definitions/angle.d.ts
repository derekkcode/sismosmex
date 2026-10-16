import { Measure } from './../index.js';
export type AngleUnits = AngleSIUnits;
export type AngleSystems = 'SI';
export type AngleSIUnits = 'rad' | 'deg' | 'grad' | 'arcmin' | 'arcsec';
declare const measure: Measure<AngleSystems, AngleUnits>;
export default measure;
