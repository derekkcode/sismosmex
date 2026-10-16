export interface Wrapper<T> {
    create(value: string | number): T;
    add(left: string | number | T, right: string | number | T): T;
    sub(left: string | number | T, right: string | number | T): T;
    mul(left: string | number | T, right: string | number | T): T;
    div(left: string | number | T, right: string | number | T): T;
    lt(left: string | number | T, right: string | number | T): boolean;
    lte(left: string | number | T, right: string | number | T): boolean;
    gt(left: string | number | T, right: string | number | T): boolean;
    gte(left: string | number | T, right: string | number | T): boolean;
}
export declare function isWrapper<T>(wrapper: unknown): wrapper is Wrapper<T>;
export declare class NotAValidNumber extends Error {
}
