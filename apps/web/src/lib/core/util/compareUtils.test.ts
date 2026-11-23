import { expect, it } from 'vitest';
import { deepEqual } from './compareUtils';

it('compares dates by the instant they hold', () => {
  expect(
    deepEqual(
      { viewedAt: new Date('2026-09-26T12:00:00Z') },
      { viewedAt: new Date('2026-09-26T12:00:00Z') }
    )
  ).toBe(true);
  expect(
    deepEqual(
      { viewedAt: new Date('2026-09-26T12:00:00Z') },
      { viewedAt: new Date('2026-09-27T12:00:00Z') }
    )
  ).toBe(false);
  expect(
    deepEqual(
      { viewedAt: new Date('2026-09-26T12:00:00Z') },
      { viewedAt: '2026-09-26T12:00:00.000Z' }
    )
  ).toBe(false);
});
