(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NotAValidNumber = void 0;
    exports.isWrapper = isWrapper;
    function isWrapper(wrapper) {
        return (wrapper != null &&
            typeof wrapper === 'object' &&
            'create' in wrapper &&
            typeof wrapper.create === 'function' &&
            'add' in wrapper &&
            typeof wrapper.add === 'function' &&
            'sub' in wrapper &&
            typeof wrapper.sub === 'function' &&
            'mul' in wrapper &&
            typeof wrapper.mul === 'function' &&
            'div' in wrapper &&
            typeof wrapper.div === 'function' &&
            'lt' in wrapper &&
            typeof wrapper.lt === 'function' &&
            'lte' in wrapper &&
            typeof wrapper.lte === 'function' &&
            'gt' in wrapper &&
            typeof wrapper.gt === 'function' &&
            'gte' in wrapper &&
            typeof wrapper.gte === 'function');
    }
    class NotAValidNumber extends Error {
    }
    exports.NotAValidNumber = NotAValidNumber;
});
