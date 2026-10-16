import { NotAValidNumber } from './wrapper.js';
const DefaultWrapper = {
    create(value) {
        const result = Number(value);
        if (Number.isNaN(result)) {
            throw new NotAValidNumber(`"${value}" cannot be parsed into a number`);
        }
        return result;
    },
    add(left, right) {
        return Number(left) + Number(right);
    },
    sub(left, right) {
        return Number(left) - Number(right);
    },
    mul(left, right) {
        return Number(left) * Number(right);
    },
    div(left, right) {
        return Number(left) / Number(right);
    },
    lt(left, right) {
        return Number(left) < Number(right);
    },
    lte(left, right) {
        return Number(left) <= Number(right);
    },
    gt(left, right) {
        return Number(left) > Number(right);
    },
    gte(left, right) {
        return Number(left) >= Number(right);
    },
};
export default DefaultWrapper;
