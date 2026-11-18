// Set the oracle UA after environment creation: Vitest 4's userAgent option
// constructs ResourceLoader, which the pinned jsdom 29 no longer exports.
Object.defineProperty(navigator, 'userAgent', {
  configurable: true,
  value: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
});

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
