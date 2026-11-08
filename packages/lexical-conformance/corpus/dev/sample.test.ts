import { expect, test } from 'bun:test';
import { validateSample } from './sample';

test('sample admission rejects oversized, duplicate and malformed id inventories', () => {
  expect(validateSample({ version: 1, ids: ['opaque-a', 'opaque-b'] })).toEqual(
    ['opaque-a', 'opaque-b']
  );
  expect(() => validateSample({ version: 1, ids: ['same', 'same'] })).toThrow();
  expect(() => validateSample({ version: 1, ids: [1] })).toThrow();
  expect(() =>
    validateSample({
      version: 1,
      ids: Array.from({ length: 2001 }, (_, i) => `opaque-${i}`),
    })
  ).toThrow();
});
