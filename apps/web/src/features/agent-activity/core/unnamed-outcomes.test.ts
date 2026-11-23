import { describe, expect, it } from 'vitest';
import { isUnnamedOutcome, UNNAMED_OUTCOME_LABELS } from './unnamed-outcomes';

describe('isUnnamedOutcome', () => {
  it("pins the fold's labels (code_execution.rs UNNAMED_STEP_LABELS)", () => {
    expect(UNNAMED_OUTCOME_LABELS).toEqual({
      failed: 'A step failed',
      interrupted: 'Step interrupted',
    });
  });

  it('matches only an unnamed outcome with its own status', () => {
    expect(isUnnamedOutcome({ label: 'A step failed', status: 'failed' })).toBe(
      true
    );
    expect(
      isUnnamedOutcome({ label: 'Step interrupted', status: 'interrupted' })
    ).toBe(true);
    expect(isUnnamedOutcome({ label: 'Update task', status: 'failed' })).toBe(
      false
    );
    expect(
      isUnnamedOutcome({ label: 'A step failed', status: 'completed' })
    ).toBe(false);
    expect(
      isUnnamedOutcome({ label: 'Finished a step', status: 'completed' })
    ).toBe(false);
  });
});
