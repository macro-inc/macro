import { expect, test } from 'bun:test';
import { limitsFor } from '../src/limit';

test('a browser is limited by its client IP', () => {
  expect(limitsFor('203.0.113.7', undefined)).toEqual([
    { limiter: 'RATE_LIMITER', key: '203.0.113.7' },
  ]);
});

test('a computer is limited on its own and under its egress IP fleet ceiling', () => {
  expect(
    limitsFor('203.0.113.7', '01900000-0000-7000-8000-000000000001')
  ).toEqual([
    {
      limiter: 'COMPUTER_RATE_LIMITER',
      key: '01900000-0000-7000-8000-000000000001',
    },
    { limiter: 'COMPUTER_FLEET_RATE_LIMITER', key: '203.0.113.7' },
  ]);
});

test('a malformed computer id counts as a browser', () => {
  for (const id of ['', 'a b', 'x'.repeat(65), 'id;drop'])
    expect(limitsFor('203.0.113.7', id)).toEqual([
      { limiter: 'RATE_LIMITER', key: '203.0.113.7' },
    ]);
});
