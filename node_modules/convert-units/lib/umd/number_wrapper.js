(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./wrapper.js"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const wrapper_js_1 = require("./wrapper.js");
    const DefaultWrapper = {
        create(value) {
            const result = Number(value);
            if (Number.isNaN(result)) {
                throw new wrapper_js_1.NotAValidNumber(`"${value}" cannot be parsed into a number`);
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
    exports.default = DefaultWrapper;
});
