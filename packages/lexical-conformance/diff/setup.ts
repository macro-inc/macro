// No generated command asks for layout. jsdom nevertheless needs Range geometry
// when upstream reconciles a noncollapsed browser selection.
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => new DOMRect(),
});
Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [],
});
