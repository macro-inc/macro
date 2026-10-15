// jsdom has no layout engine. Supply the browser API used by shared controls;
// tests that verify resize behavior install their own observer implementation.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
