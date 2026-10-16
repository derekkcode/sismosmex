"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SI = {
    V: {
        name: {
            singular: 'Volt',
            plural: 'Volts',
        },
        to_anchor: 1,
    },
    μV: {
        name: {
            singular: 'Microvolt',
            plural: 'Microvolts',
        },
        to_anchor: 1e-6,
    },
    mV: {
        name: {
            singular: 'Millivolt',
            plural: 'Millivolts',
        },
        to_anchor: 1e-3,
    },
    kV: {
        name: {
            singular: 'Kilovolt',
            plural: 'Kilovolts',
        },
        to_anchor: 1e3,
    },
    MV: {
        name: {
            singular: 'Megavolt',
            plural: 'Megavolts',
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
