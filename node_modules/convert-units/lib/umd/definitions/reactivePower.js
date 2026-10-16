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
        VAR: {
            name: {
                singular: 'Volt-Ampere Reactive',
                plural: 'Volt-Amperes Reactive',
            },
            to_anchor: 1,
        },
        mVAR: {
            name: {
                singular: 'Millivolt-Ampere Reactive',
                plural: 'Millivolt-Amperes Reactive',
            },
            to_anchor: 1e-3,
        },
        kVAR: {
            name: {
                singular: 'Kilovolt-Ampere Reactive',
                plural: 'Kilovolt-Amperes Reactive',
            },
            to_anchor: 1e3,
        },
        MVAR: {
            name: {
                singular: 'Megavolt-Ampere Reactive',
                plural: 'Megavolt-Amperes Reactive',
            },
            to_anchor: 1e6,
        },
        GVAR: {
            name: {
                singular: 'Gigavolt-Ampere Reactive',
                plural: 'Gigavolt-Amperes Reactive',
            },
            to_anchor: 1e9,
        },
    };
    const measure = {
        systems: {
            SI,
        },
    };
    exports.default = measure;
});
