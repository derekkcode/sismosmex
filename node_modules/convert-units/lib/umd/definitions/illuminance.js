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
        lx: {
            name: {
                singular: 'Lux',
                plural: 'Lux',
            },
            to_anchor: 1,
        },
    };
    const imperial = {
        'ft-cd': {
            name: {
                singular: 'Foot-candle',
                plural: 'Foot-candles',
            },
            to_anchor: 1,
        },
    };
    const measure = {
        systems: {
            metric,
            imperial,
        },
        anchors: {
            metric: {
                imperial: {
                    ratio: {
                        numerator: 1,
                        denominator: 10.76391,
                    },
                },
            },
            imperial: {
                metric: {
                    ratio: 10.76391,
                },
            },
        },
    };
    exports.default = measure;
});
