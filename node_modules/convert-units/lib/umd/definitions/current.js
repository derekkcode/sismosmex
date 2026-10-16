(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const SI = {
        A: {
            name: {
                singular: 'Ampere',
                plural: 'Amperes',
            },
            to_anchor: 1,
        },
        μA: {
            name: {
                singular: 'Microampere',
                plural: 'Microamperes',
            },
            to_anchor: 1e-6,
        },
        mA: {
            name: {
                singular: 'Milliampere',
                plural: 'Milliamperes',
            },
            to_anchor: 1e-3,
        },
        kA: {
            name: {
                singular: 'Kiloampere',
                plural: 'Kiloamperes',
            },
            to_anchor: 1e3,
        },
        MA: {
            name: {
                singular: 'Megaampere',
                plural: 'Megaamperes',
            },
            to_anchor: 1e6,
        },
    };
    const measure = {
        systems: {
            SI,
        },
    };
    exports.default = measure;
});
