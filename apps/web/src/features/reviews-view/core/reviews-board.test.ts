import { describe, expect, it } from 'vitest';
import { reviewsBoardAction, reviewsBoardStage } from './reviews-board';

const passed = { status: 'completed', conclusion: 'success' };
const failed = { status: 'completed', conclusion: 'failure' };
const running = { status: 'in_progress', conclusion: null };

describe('reviewsBoardStage', () => {
  it('places merged and closed pull requests', () => {
    expect(reviewsBoardStage({ status: 'merged', checks: [failed] })).toBe(
      'merged'
    );
    expect(reviewsBoardStage({ status: 'closed' })).toBeUndefined();
  });

  it('keeps drafts in Draft whatever their checks or conflicts say', () => {
    expect(
      reviewsBoardStage({
        status: 'open',
        draft: true,
        checks: [failed],
        mergeability: 'conflicting',
      })
    ).toBe('draft');
  });

  it('ranks conflicts over failing checks over a clean run', () => {
    expect(
      reviewsBoardStage({
        status: 'open',
        checks: [failed],
        mergeability: 'conflicting',
      })
    ).toBe('conflicts');
    expect(
      reviewsBoardStage({ status: 'open', checks: [passed, failed] })
    ).toBe('failing');
    expect(
      reviewsBoardStage({
        status: 'open',
        checks: [passed],
        mergeability: 'mergeable',
      })
    ).toBe('ready');
  });

  it('keeps pull requests with running or missing checks in review', () => {
    expect(
      reviewsBoardStage({ status: 'open', checks: [passed, running] })
    ).toBe('review');
    expect(reviewsBoardStage({ status: 'open', checks: [] })).toBe('review');
  });
});

describe('reviewsBoardAction', () => {
  it('merges from In review and Ready to merge only', () => {
    expect(reviewsBoardAction('ready', 'merged')).toBe('merge');
    expect(reviewsBoardAction('review', 'merged')).toBe('merge');
    expect(reviewsBoardAction('failing', 'merged')).toBeUndefined();
    expect(reviewsBoardAction('conflicts', 'merged')).toBeUndefined();
    expect(reviewsBoardAction('draft', 'merged')).toBeUndefined();
  });

  it('converts any open pull request to a draft and marks drafts ready', () => {
    for (const from of ['review', 'failing', 'conflicts', 'ready'] as const)
      expect(reviewsBoardAction(from, 'draft')).toBe('convert-to-draft');
    expect(reviewsBoardAction('draft', 'review')).toBe('mark-ready');
  });

  it('rejects drops on GitHub verdicts and moves out of Merged', () => {
    expect(reviewsBoardAction('review', 'failing')).toBeUndefined();
    expect(reviewsBoardAction('review', 'conflicts')).toBeUndefined();
    expect(reviewsBoardAction('review', 'ready')).toBeUndefined();
    expect(reviewsBoardAction('ready', 'review')).toBeUndefined();
    expect(reviewsBoardAction('merged', 'draft')).toBeUndefined();
    expect(reviewsBoardAction('draft', 'draft')).toBeUndefined();
  });
});
