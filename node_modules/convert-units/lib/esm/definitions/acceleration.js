const metric = {
    'g-force': {
        name: {
            singular: 'g-force',
            plural: 'g-forces',
        },
        to_anchor: 9.80665,
    },
    'm/s2': {
        name: {
            singular: 'Metre per second squared',
            plural: 'Metres per second squared',
        },
        to_anchor: 1,
    },
    g0: {
        name: {
            singular: 'Standard Gravity',
            plural: 'Standard Gravities',
        },
        to_anchor: 9.80665,
    },
};
const measure = {
    systems: {
        metric,
    },
};
export default measure;
