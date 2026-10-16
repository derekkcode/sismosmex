import { Measure } from './../index.js';
export type PiecesUnits = PiecesUnitUnits;
export type PiecesSystems = 'unit';
export type PiecesUnitUnits = 'pcs' | 'bk-doz' | 'cp' | 'doz-doz' | 'doz' | 'gr-gr' | 'gros' | 'half-dozen' | 'long-hundred' | 'ream' | 'scores' | 'sm-gr' | 'trio';
declare const measure: Measure<PiecesSystems, PiecesUnits>;
export default measure;
