import { expect, test } from 'vitest';

test('deliberate failure for CI proof', () => {
  expect(1).toBe(2);
});
