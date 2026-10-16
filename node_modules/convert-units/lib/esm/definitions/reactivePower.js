const SI = {
    VAR: {
        name: {
            singular: 'Volt-Ampere Reactive',
            plural: 'Volt-Amperes Reactive',
        },
        to_anchor: 1,
    },
    mVAR: {
        name: {
            singular: 'Millivolt-Ampere Reactive',
            plural: 'Millivolt-Amperes Reactive',
        },
        to_anchor: 1e-3,
    },
    kVAR: {
        name: {
            singular: 'Kilovolt-Ampere Reactive',
            plural: 'Kilovolt-Amperes Reactive',
        },
        to_anchor: 1e3,
    },
    MVAR: {
        name: {
            singular: 'Megavolt-Ampere Reactive',
            plural: 'Megavolt-Amperes Reactive',
        },
        to_anchor: 1e6,
    },
    GVAR: {
        name: {
            singular: 'Gigavolt-Ampere Reactive',
            plural: 'Gigavolt-Amperes Reactive',
        },
        to_anchor: 1e9,
    },
};
const measure = {
    systems: {
        SI,
    },
};
export default measure;
