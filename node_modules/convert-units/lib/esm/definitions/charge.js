const SI = {
    c: {
        name: {
            singular: 'Coulomb',
            plural: 'Coulombs',
        },
        to_anchor: 1,
    },
    mC: {
        name: {
            singular: 'Millicoulomb',
            plural: 'Millicoulombs',
        },
        to_anchor: {
            numerator: 1,
            denominator: 1000,
        },
    },
    μC: {
        name: {
            singular: 'Microcoulomb',
            plural: 'Microcoulombs',
        },
        to_anchor: {
            numerator: 1,
            denominator: 1e6,
        },
    },
    nC: {
        name: {
            singular: 'Nanocoulomb',
            plural: 'Nanocoulombs',
        },
        to_anchor: 1e-9,
    },
    pC: {
        name: {
            singular: 'Picocoulomb',
            plural: 'Picocoulombs',
        },
        to_anchor: 1e-12,
    },
};
const measure = {
    systems: {
        SI,
    },
};
export default measure;
