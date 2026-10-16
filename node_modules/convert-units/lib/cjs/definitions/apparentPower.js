"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SI = {
    VA: {
        name: {
            singular: 'Volt-Ampere',
            plural: 'Volt-Amperes',
        },
        to_anchor: 1,
    },
    mVA: {
        name: {
            singular: 'Millivolt-Ampere',
            plural: 'Millivolt-Amperes',
        },
        to_anchor: 1e-3,
    },
    kVA: {
        name: {
            singular: 'Kilovolt-Ampere',
            plural: 'Kilovolt-Amperes',
        },
        to_anchor: 1e3,
    },
    MVA: {
        name: {
            singular: 'Megavolt-Ampere',
            plural: 'Megavolt-Amperes',
        },
        to_anchor: 1e6,
    },
    GVA: {
        name: {
            singular: 'Gigavolt-Ampere',
            plural: 'Gigavolt-Amperes',
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
