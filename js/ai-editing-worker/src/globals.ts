// Stub browser globals that lexical-core pulls in transitively but the worker doesn't need.
// One universal sink that is both callable and has all property accesses absorbed.
// Using `let` + assignment so the closure captures the final value.
// biome-ignore lint/suspicious/noExplicitAny: structural any — noopProxy absorbs all shapes
let noopProxy: any;
// biome-ignore lint/suspicious/noExplicitAny: structural any — Proxy target must match callable
noopProxy = new Proxy((() => noopProxy) as any, {
  get(_t, k) {
    if (k === Symbol.toPrimitive || k === 'valueOf') return () => 0;
    if (k === 'toString' || k === 'toLocaleString') return () => '';
    if (k === Symbol.iterator) return function* () {};
    if (k === 'length' || k === 'size') return 0;
    return noopProxy;
  },
  set() {
    return true;
  },
  defineProperty() {
    return true;
  },
  has() {
    return true;
  },
  apply() {
    return noopProxy;
  },
  construct() {
    return noopProxy;
  },
});

// biome-ignore lint/suspicious/noExplicitAny: globalThis assignment for worker polyfill
(globalThis as any).Prism = {
  highlight: (code: string) => code,
  languages: noopProxy,
  hooks: noopProxy,
  extend: noopProxy,
  util: noopProxy,
};
