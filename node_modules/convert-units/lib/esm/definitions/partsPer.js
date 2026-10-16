const SI = {
    ppm: {
        name: {
            singular: 'Part-per Million',
            plural: 'Parts-per Million',
        },
        to_anchor: 1,
    },
    ppb: {
        name: {
            singular: 'Part-per Billion',
            plural: 'Parts-per Billion',
        },
        to_anchor: 1e-3,
    },
    ppt: {
        name: {
            singular: 'Part-per Trillion',
            plural: 'Parts-per Trillion',
        },
        to_anchor: 1e-6,
    },
    ppq: {
        name: {
            singular: 'Part-per Quadrillion',
            plural: 'Parts-per Quadrillion',
        },
        to_anchor: 1e-9,
    },
};
const measure = {
    systems: {
        SI,
    },
};
export default measure;
