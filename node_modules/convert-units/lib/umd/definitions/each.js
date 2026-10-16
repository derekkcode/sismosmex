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
    const metric = {
        ea: {
            name: {
                singular: 'Each',
                plural: 'Each',
            },
            to_anchor: 1,
        },
        dz: {
            name: {
                singular: 'Dozen',
                plural: 'Dozens',
            },
            to_anchor: 12,
        },
    };
    const measure = {
        systems: {
            metric,
        },
    };
    exports.default = measure;
});
