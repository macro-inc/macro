import { describe, expect, it } from 'vitest';
import { programFailures } from './code-execution';

describe('programFailures', () => {
  it('counts the failed operations and calls a program shows', () => {
    expect(
      programFailures({
        statuses: ['completed', 'failed', 'unknown', 'failed'],
        ended: true,
        cancelled: false,
      })
    ).toBe(2);
  });

  it('counts the one row of a program that ended without steps', () => {
    expect(
      programFailures({ statuses: [], ended: true, cancelled: false })
    ).toBe(1);
  });

  it('does not count a program that was stopped, or is still going', () => {
    expect(
      programFailures({ statuses: [], ended: true, cancelled: true })
    ).toBe(0);
    expect(
      programFailures({ statuses: [], ended: false, cancelled: false })
    ).toBe(0);
  });
});
