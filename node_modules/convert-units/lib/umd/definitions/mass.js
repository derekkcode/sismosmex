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
        mcg: {
            name: {
                singular: 'Microgram',
                plural: 'Micrograms',
            },
            to_anchor: {
                numerator: 1,
                denominator: 1e6,
            },
        },
        mg: {
            name: {
                singular: 'Milligram',
                plural: 'Milligrams',
            },
            to_anchor: {
                numerator: 1,
                denominator: 1e3,
            },
        },
        g: {
            name: {
                singular: 'Gram',
                plural: 'Grams',
            },
            to_anchor: 1,
        },
        kg: {
            name: {
                singular: 'Kilogram',
                plural: 'Kilograms',
            },
            to_anchor: 1e3,
        },
        mt: {
            name: {
                singular: 'Metric Tonne',
                plural: 'Metric Tonnes',
            },
            to_anchor: 1e6,
        },
    };
    const imperial = {
        oz: {
            name: {
                singular: 'Ounce',
                plural: 'Ounces',
            },
            to_anchor: {
                numerator: 1,
                denominator: 16,
            },
        },
        lb: {
            name: {
                singular: 'Pound',
                plural: 'Pounds',
            },
            to_anchor: 1,
        },
        st: {
            name: {
                singular: 'Stone',
                plural: 'Stones',
            },
            to_anchor: 14,
        },
        t: {
            name: {
                singular: 'Ton',
                plural: 'Tons',
            },
            to_anchor: 2e3,
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
                        denominator: 453.59237,
                    },
                },
            },
            imperial: {
                metric: {
                    ratio: 453.59237,
                },
            },
        },
    };
    exports.default = measure;
});
