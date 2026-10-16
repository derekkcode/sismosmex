const metric = {
    'kg/s': {
        name: {
            singular: 'Kilogram per second',
            plural: 'Kilograms per second',
        },
        to_anchor: 1,
    },
    'kg/min': {
        name: {
            singular: 'Kilogram per minute',
            plural: 'Kilograms per minute',
        },
        to_anchor: 1 / 60,
    },
    'kg/h': {
        name: {
            singular: 'Kilogram per hour',
            plural: 'Kilograms per hour',
        },
        to_anchor: {
            numerator: 1,
            denominator: 3.6e3,
        },
    },
    'mt/h': {
        name: {
            singular: 'Ton per hour',
            plural: 'Tons per hour',
        },
        to_anchor: {
            numerator: 1,
            denominator: 3.6,
        },
    },
};
const imperial = {
    'lb/s': {
        name: {
            singular: 'Pound per second',
            plural: 'Pounds per second',
        },
        to_anchor: 1,
    },
    'lb/h': {
        name: {
            singular: 'Pound per hour',
            plural: 'Pounds per hour',
        },
        to_anchor: {
            numerator: 1,
            denominator: 3.6e3,
        },
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
                    denominator: 0.453592,
                },
            },
        },
        imperial: {
            metric: {
                ratio: 0.453592,
            },
        },
    },
};
export default measure;
