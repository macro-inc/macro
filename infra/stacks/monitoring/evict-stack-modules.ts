// Bun shares one module cache across the test files of a run, and this stack's
// modules register their Pulumi resources once, when first imported. A test
// file calls this before importing them, so they register again against its
// own mocks instead of the previous file's.
export function evictStackModules(): void {
  for (const path of Object.keys(require.cache)) {
    if (path.startsWith(__dirname) && !path.includes('/node_modules/')) {
      delete require.cache[path];
    }
  }
}
