import { Measure } from './../index.js';
export type DigitalUnits = DigitalBitUnits | DigitalByteUnits | DigitalIECBitUnits | DigitalIECByteUnits;
export type DigitalSystems = 'bit' | 'byte' | 'IECBit' | 'IECByte';
export type DigitalBitUnits = 'bit' | 'kb' | 'Mb' | 'Gb' | 'Tb';
export type DigitalByteUnits = 'byte' | 'kB' | 'MB' | 'GB' | 'TB';
export type DigitalIECBitUnits = 'Kib' | 'Mib' | 'Gib' | 'Tib';
export type DigitalIECByteUnits = 'KiB' | 'MiB' | 'GiB' | 'TiB';
declare const measure: Measure<DigitalSystems, DigitalUnits>;
export default measure;
