import { expect, test } from 'vitest';
import { compareNumberWithUpstreamType } from '../compatibility-exceptions';

test('ordering retains signed zero, infinities and NaN without normalizing the input', () => {
  expect(compareNumberWithUpstreamType(1, 2)).toBe(-1);
  expect(compareNumberWithUpstreamType(2, 1)).toBe(1);
  expect(compareNumberWithUpstreamType(1, 1)).toBe(0);
  expect(Object.is(compareNumberWithUpstreamType(-0, 0), -0)).toBe(true);
  expect(compareNumberWithUpstreamType(Infinity, -Infinity)).toBe(1);
  expect(Number.isNaN(compareNumberWithUpstreamType(Infinity, Infinity))).toBe(
    true
  );
  expect(Number.isNaN(compareNumberWithUpstreamType(NaN, 0))).toBe(true);
});
