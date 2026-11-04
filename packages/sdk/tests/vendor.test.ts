import { expect, test } from 'bun:test';
import { staleVendoredFiles } from '../scripts/vendor';

test('the vendored lexical-core matches packages/lexical-core', async () => {
  // Run `bun run vendor` when this fails.
  expect(await staleVendoredFiles()).toEqual([]);
});
