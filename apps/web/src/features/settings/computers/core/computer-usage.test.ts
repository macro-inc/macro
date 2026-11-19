import { expect, it } from 'vitest';
import { hasReadings } from './computer-usage';

it('a computer with no reading in the last day has no readings', () => {
  expect(
    hasReadings({
      computerId: 'computer-1',
      latest: null,
      points: [null, null],
    })
  ).toBe(false);
});

it('a computer that ran earlier today has readings though it has none now', () => {
  expect(
    hasReadings({
      computerId: 'computer-1',
      latest: null,
      points: [null, { cpuPercent: 12, memoryBytes: 1024 }],
    })
  ).toBe(true);
});
