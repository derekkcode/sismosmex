const metric = {
    'm/s': {
        name: {
            singular: 'Metre per second',
            plural: 'Metres per second',
        },
        to_anchor: 3.6,
    },
    'km/h': {
        name: {
            singular: 'Kilometre per hour',
            plural: 'Kilometres per hour',
        },
        to_anchor: 1,
    },
    'mm/h': {
        name: {
            singular: 'Millimeter per hour',
            plural: 'Millimeters per hour',
        },
        to_anchor: 1e-6,
    },
};
const imperial = {
    mph: {
        name: {
            singular: 'Mile per hour',
            plural: 'Miles per hour',
        },
        to_anchor: 1,
    },
    knot: {
        name: {
            singular: 'Knot',
            plural: 'Knots',
        },
        to_anchor: 1.150779,
    },
    'ft/s': {
        name: {
            singular: 'Foot per second',
            plural: 'Feet per second',
        },
        to_anchor: 0.681818,
    },
    'ft/min': {
        name: {
            singular: 'Foot per minute',
            plural: 'Feet per minute',
        },
        to_anchor: 1.13636e-2,
    },
    'in/h': {
        name: {
            singular: 'Inch per hour',
            plural: 'Inches per hour',
        },
        to_anchor: 1.578e-5,
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
                    denominator: 1.609344,
                },
            },
        },
        imperial: {
            metric: {
                ratio: 1.609344,
            },
        },
    },
};
export default measure;
