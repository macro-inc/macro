import { describe, expect, it } from 'vitest';
import {
  type CodeUpgradeRecord,
  pendingCodeReview,
  taskSdk,
} from './code-review';

const task = (source: string, sdk?: string) => ({
  steps: [
    { type: 'code', title: 'File invoices', source },
    { type: 'agent', model: 'm', instructions: 'Summarize' },
  ],
  ...(sdk ? { sdk } : {}),
});

const needsUpdate = (proposal?: unknown): CodeUpgradeRecord => ({
  toSdk: '0.3.0+new',
  outcome: 'needs_update',
  reason: '“File invoices” failed a dry run.',
  previousTask: task('macro.tasks.create(x)', '0.2.0+old'),
  task: proposal,
});

describe('code review', () => {
  it('shows the newest upgrade that paused the routine, with what changed', () => {
    const review = pendingCodeReview(
      [needsUpdate(task('macro.tasks.add(x)', '0.3.0+new'))],
      '0.2.0+old'
    );
    expect(review).toEqual({
      reason: '“File invoices” failed a dry run.',
      sdk: '0.3.0+new',
      proposal: {
        task: task('macro.tasks.add(x)', '0.3.0+new'),
        changes: [
          {
            title: 'File invoices',
            before: 'macro.tasks.create(x)',
            after: 'macro.tasks.add(x)',
          },
        ],
      },
    });
  });

  it('has nothing to approve when the model wrote no update', () => {
    expect(pendingCodeReview([needsUpdate()], '0.2.0+old')?.proposal).toBe(
      undefined
    );
  });

  it('is resolved once a save checks the code against that SDK, or a later upgrade went through', () => {
    expect(pendingCodeReview([needsUpdate()], '0.3.0+new')).toBeUndefined();
    expect(
      pendingCodeReview(
        [{ ...needsUpdate(), outcome: 'checked', reason: null }, needsUpdate()],
        '0.2.0+old'
      )
    ).toBeUndefined();
    expect(pendingCodeReview([], undefined)).toBeUndefined();
  });

  it('reads the SDK a stored task was checked against', () => {
    expect(taskSdk(task('x', '0.2.0+old'))).toBe('0.2.0+old');
    expect(taskSdk({ steps: [] })).toBeUndefined();
    expect(taskSdk(null)).toBeUndefined();
  });
});
