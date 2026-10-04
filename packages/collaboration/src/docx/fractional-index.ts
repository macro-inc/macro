/**
 * Fractional position keys for ordering blocks inside a CRDT map.
 *
 * Keys are base-62 fractions in (0, 1) compared as plain strings. A key never
 * ends in the smallest digit, so there is always room before and after it.
 * Concurrent writers can mint the same key; readers break ties by block id.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digitValue(char: string): number {
  const value = DIGITS.indexOf(char);
  if (value < 0) throw new Error(`invalid fractional key digit "${char}"`);
  return value;
}

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    let shared = 0;
    while (shared < high.length && (low[shared] ?? DIGITS[0]) === high[shared])
      shared++;
    if (shared > 0)
      return (
        high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared))
      );
  }
  const lowDigit = low ? digitValue(low[0]) : 0;
  const highDigit = high !== null ? digitValue(high[0]) : BASE;
  if (highDigit - lowDigit > 1)
    return DIGITS[Math.floor((lowDigit + highDigit) / 2)];
  // Adjacent digits: the high key's first digit alone sorts between them when
  // the high key continues, otherwise extend the low key.
  if (high !== null && high.length > 1) return high[0];
  return DIGITS[lowDigit] + midpoint(low.slice(1), null);
}

function assertKey(key: string | null, name: string) {
  if (key === null) return;
  if (key === '' || key.endsWith(DIGITS[0]))
    throw new Error(`invalid fractional ${name} key "${key}"`);
  for (const char of key) digitValue(char);
}

/** A key strictly between `low` and `high`; null means the open end. */
export function keyBetween(low: string | null, high: string | null): string {
  assertKey(low, 'low');
  assertKey(high, 'high');
  if (low !== null && high !== null && low >= high)
    throw new Error(`fractional keys out of order: ${low} >= ${high}`);
  return midpoint(low ?? '', high);
}

/** `count` ascending keys between `low` and `high`, growing logarithmically. */
export function keysBetween(
  low: string | null,
  high: string | null,
  count: number
): string[] {
  if (count <= 0) return [];
  const middle = keyBetween(low, high);
  if (count === 1) return [middle];
  const before = Math.floor((count - 1) / 2);
  return [
    ...keysBetween(low, middle, before),
    middle,
    ...keysBetween(middle, high, count - 1 - before),
  ];
}

/** Stable order for (key, id) pairs: key first, id breaks concurrent ties. */
export function compareKeyed(
  a: { key: string; id: string },
  b: { key: string; id: string }
): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
