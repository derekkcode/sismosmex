"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SI = {
    N: {
        name: {
            singular: 'Newton',
            plural: 'Newtons',
        },
        to_anchor: 1,
    },
    kN: {
        name: {
            singular: 'Kilonewton',
            plural: 'Kilonewtons',
        },
        to_anchor: 1000,
    },
    lbf: {
        name: {
            singular: 'Pound-force',
            plural: 'Pound-forces',
        },
        to_anchor: 4.44822,
    },
    kgf: {
        name: {
            singular: 'Kilogram-force',
            plural: 'Kilogram-forces',
        },
        to_anchor: 9.807,
    },
};
const measure = {
    systems: {
        SI,
    },
};
exports.default = measure;
