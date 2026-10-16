import { Wrapper } from './wrapper.js';
export interface Fraction {
    numerator: number | string;
    denominator: number | string;
}
export interface Unit {
    name: {
        singular: string;
        plural: string;
    };
    to_anchor: number | string | Fraction;
    anchor_shift?: number | string | Fraction;
}
export interface Conversion<TMeasures extends string, TSystems extends string, TUnits extends string> {
    abbr: TUnits;
    measure: TMeasures;
    system: TSystems;
    unit: Unit;
}
export interface UnitDescription {
    abbr: string;
    measure: string;
    system: string;
    singular: string;
    plural: string;
}
type TransformFunc = <T>(value: T, cls: Wrapper<T>) => T;
export interface Anchor {
    ratio?: number | Fraction;
    transform?: TransformFunc;
}
export interface Measure<TSystems extends string, TUnits extends string> {
    systems: Partial<Record<TSystems, Partial<Record<TUnits, Unit>>>>;
    anchors?: Partial<Record<TSystems, Partial<Record<TSystems, Anchor>>>>;
}
export interface BestResult<TUnits extends string, TValue> {
    val: TValue;
    unit: TUnits;
    singular: string;
    plural: string;
}
export type UnitCache<TMeasures, TSystems, TUnits> = Map<string, {
    system: TSystems;
    measure: TMeasures;
    unit: Unit;
    abbr: TUnits;
}>;
export declare class UnknownUnitError extends Error {
}
export declare class OperationOrderError extends Error {
}
export declare class IncompatibleUnitError extends Error {
}
export declare class MeasureStructureError extends Error {
}
export declare class UnknownMeasureError extends Error {
}
/**
 * Represents a conversion path
 */
export declare class Converter<TMeasures extends string, TSystems extends string, TUnits extends string, TValue> {
    private val;
    private cls;
    private destination;
    private origin;
    private measureData;
    private unitCache;
    constructor(options: {
        measures: Record<TMeasures, Measure<TSystems, TUnits>>;
        unitCache: UnitCache<TMeasures, TSystems, TUnits>;
        cls: Wrapper<TValue>;
    }, value?: number | string);
    /**
     * Lets the converter know the source unit abbreviation
     *
     * @throws OperationOrderError, UnknownUnitError
     */
    from(from: TUnits | (string & {})): this;
    private convertFraction;
    /**
     * Converts the unit and returns the value
     *
     * @throws OperationOrderError, UnknownUnitError, IncompatibleUnitError, MeasureStructureError
     */
    to(to: TUnits | (string & {})): TValue;
    /**
     * Converts the unit to the best available unit.
     *
     * @throws OperationOrderError
     */
    toBest(options?: {
        exclude?: (TUnits | (string & {}))[];
        cutOffNumber?: number;
        system?: TSystems | (string & {});
    }): BestResult<TUnits, TValue> | null;
    /**
     * Finds the unit
     */
    getUnit(abbr: TUnits | (string & {})): Conversion<TMeasures, TSystems, TUnits> | null;
    /**
     * Provides additional information about the unit
     *
     * @throws UnknownUnitError
     */
    describe(abbr: TUnits | (string & {})): UnitDescription;
    private describeUnit;
    /**
     * Detailed list of all supported units
     *
     * If a measure is supplied the list will only contain
     * details about that measure. Otherwise the list will contain
     * details abaout all measures.
     *
     * However, if the measure doesn't exist, an empty array will be
     * returned
     *
     *
     */
    list(measureName?: TMeasures | (string & {})): UnitDescription[] | never;
    private isMeasure;
    private throwUnsupportedUnitError;
    /**
     * Returns the abbreviated measures that the value can be
     * converted to.
     */
    possibilities(forMeasure?: TMeasures | (string & {})): TUnits[];
    /**
     * Returns the abbreviated measures that the value can be
     * converted to.
     */
    measures(): TMeasures[];
}
export declare function buildUnitCache<TMeasures extends string, TSystems extends string, TUnits extends string>(measures: Record<TMeasures, Measure<TSystems, TUnits>>): UnitCache<TMeasures, TSystems, TUnits>;
declare function configureMeasurements<TMeasures extends string, TSystems extends string, TUnits extends string>(measures: Record<TMeasures, Measure<TSystems, TUnits>>): (value?: number) => Converter<TMeasures, TSystems, TUnits, number>;
declare function configureMeasurements<TMeasures extends string, TSystems extends string, TUnits extends string, TValue>(measures: Record<TMeasures, Measure<TSystems, TUnits>>, cls: Wrapper<TValue>): (value?: number) => Converter<TMeasures, TSystems, TUnits, TValue>;
export { configureMeasurements };
