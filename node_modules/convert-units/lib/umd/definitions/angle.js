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
        rad: {
            name: {
                singular: 'radian',
                plural: 'radians',
            },
            to_anchor: {
                numerator: 180,
                denominator: Math.PI,
            },
        },
        deg: {
            name: {
                singular: 'degree',
                plural: 'degrees',
            },
            to_anchor: 1,
        },
        grad: {
            name: {
                singular: 'gradian',
                plural: 'gradians',
            },
            to_anchor: {
                numerator: 9,
                denominator: 10,
            },
        },
        arcmin: {
            name: {
                singular: 'arcminute',
                plural: 'arcminutes',
            },
            to_anchor: {
                numerator: 1,
                denominator: 60,
            },
        },
        arcsec: {
            name: {
                singular: 'arcsecond',
                plural: 'arcseconds',
            },
            to_anchor: {
                numerator: 1,
                denominator: 3600,
            },
        },
    };
    const measure = {
        systems: {
            SI,
        },
    };
    exports.default = measure;
});
