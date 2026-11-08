import { expect, test } from 'vitest';
import { pendingErrors } from '../pending';

test('pending may shrink but cannot conceal a new gap or restore a covered baseline row', () => {
  const known = new Set(['A', 'B', 'C']);
  const baseline = new Set(['A', 'B']);
  expect(
    pendingErrors(new Set(['A']), known, baseline, new Set(['A']))
  ).toEqual([]);
  expect(
    pendingErrors(new Set(['A', 'C']), known, baseline, new Set())
  ).toEqual(['Pending ratchet grew: C']);
  expect(
    pendingErrors(new Set(['A']), known, baseline, new Set(['C']))
  ).toEqual(['Required row lacks verified execution: C']);
});
