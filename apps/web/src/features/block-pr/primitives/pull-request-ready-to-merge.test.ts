import { describe, expect, it } from 'vitest';
import { pullRequestReadyToMerge } from './pull-request-ready-to-merge';

const success = { status: 'completed', conclusion: 'success' };

describe('pullRequestReadyToMerge', () => {
  it('allows an open pull request whose checks have finished successfully', () => {
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        draft: false,
        checks: [success, { status: 'completed', conclusion: 'skipped' }],
      })
    ).toBe(true);
  });

  it('hides merge for a draft, a closed pull request, or missing CI', () => {
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        draft: true,
        checks: [success],
      })
    ).toBe(false);
    expect(
      pullRequestReadyToMerge({
        status: 'merged',
        draft: false,
        checks: [success],
      })
    ).toBe(false);
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        draft: false,
        checks: [],
      })
    ).toBe(false);
    expect(
      pullRequestReadyToMerge({ status: 'open', draft: false, checks: null })
    ).toBe(false);
  });

  it('hides merge while a check is still running or has failed', () => {
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        checks: [success, { status: 'in_progress', conclusion: null }],
      })
    ).toBe(false);
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        checks: [{ status: 'completed', conclusion: 'failure' }],
      })
    ).toBe(false);
    expect(
      pullRequestReadyToMerge({
        status: 'open',
        checks: [{ status: 'completed', conclusion: 'cancelled' }],
      })
    ).toBe(false);
  });
});
