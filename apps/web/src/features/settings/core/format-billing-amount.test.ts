import { expect, it } from 'vitest';
import { formatBillingAmount } from './format-billing-amount';

it.each([
  ['usd', 12345, '$123.45'],
  ['jpy', 3000, '¥3,000'],
  ['kwd', 1234, 'KWD\u00a01.234'],
  ['isk', 100000, 'ISK\u00a01,000'],
  ['ugx', 100000, 'UGX\u00a01,000'],
] as const)(
  'formats %s provider amounts in their real units',
  (currency, amount, expected) => {
    expect(formatBillingAmount(amount, currency, 'en-US')).toBe(expected);
  }
);
