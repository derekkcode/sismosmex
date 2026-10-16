"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SI = {
    VARh: {
        name: {
            singular: 'Volt-Ampere Reactive Hour',
            plural: 'Volt-Amperes Reactive Hour',
        },
        to_anchor: 1,
    },
    mVARh: {
        name: {
            singular: 'Millivolt-Ampere Reactive Hour',
            plural: 'Millivolt-Amperes Reactive Hour',
        },
        to_anchor: 1e-3,
    },
    kVARh: {
        name: {
            singular: 'Kilovolt-Ampere Reactive Hour',
            plural: 'Kilovolt-Amperes Reactive Hour',
        },
        to_anchor: 1e3,
    },
    MVARh: {
        name: {
            singular: 'Megavolt-Ampere Reactive Hour',
            plural: 'Megavolt-Amperes Reactive Hour',
        },
        to_anchor: 1e6,
    },
    GVARh: {
        name: {
            singular: 'Gigavolt-Ampere Reactive Hour',
            plural: 'Gigavolt-Amperes Reactive Hour',
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
