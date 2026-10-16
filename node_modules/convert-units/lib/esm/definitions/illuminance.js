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
export default measure;
