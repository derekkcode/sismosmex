"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const metric = {
    W: {
        name: {
            singular: 'Watt',
            plural: 'Watts',
        },
        to_anchor: 1,
    },
    mW: {
        name: {
            singular: 'Milliwatt',
            plural: 'Milliwatts',
        },
        to_anchor: 1e-3,
    },
    kW: {
        name: {
            singular: 'Kilowatt',
            plural: 'Kilowatts',
        },
        to_anchor: 1e3,
    },
    MW: {
        name: {
            singular: 'Megawatt',
            plural: 'Megawatts',
        },
        to_anchor: 1e6,
    },
    GW: {
        name: {
            singular: 'Gigawatt',
            plural: 'Gigawatts',
        },
        to_anchor: 1e9,
    },
    PS: {
        name: {
            singular: 'Horsepower (metric)',
            plural: 'Horsepower (metric)',
        },
        to_anchor: 735.49875,
    },
};
const imperial = {
    'Btu/s': {
        name: {
            singular: 'British thermal unit per second',
            plural: 'British thermal units per second',
        },
        to_anchor: 778.16937,
    },
    'ft-lb/s': {
        name: {
            singular: 'Foot-pound per second',
            plural: 'Foot-pounds per second',
        },
        to_anchor: 1,
    },
    hp: {
        name: {
            singular: 'Horsepower (British)',
            plural: 'Horsepower (British)',
        },
        to_anchor: 550,
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
                ratio: 0.737562149,
            },
        },
        imperial: {
            metric: {
                ratio: {
                    numerator: 1,
                    denominator: 0.737562149,
                },
            },
        },
    },
};
exports.default = measure;
