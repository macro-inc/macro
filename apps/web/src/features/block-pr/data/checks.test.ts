import type { GithubPullRequestCheckRun } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { orderChecks, summarizeChecks } from './checks';

const check = (
  name: string,
  status: string,
  conclusion?: string
): GithubPullRequestCheckRun => ({
  id: name.length,
  name,
  status,
  conclusion,
});

const CHECKS = [
  check('typecheck', 'completed', 'success'),
  check('preview', 'completed', 'skipped'),
  check('unit tests', 'completed', 'failure'),
  check('queued', 'queued'),
  check('lint', 'completed', 'success'),
  check('deploy', 'completed', 'timed_out'),
  check('browser tests', 'in_progress'),
];

describe('summarizeChecks', () => {
  it('counts failures and pending checks, not only passes', () => {
    expect(summarizeChecks(CHECKS)).toEqual({
      failed: 2,
      pending: 2,
      passed: 2,
    });
  });

  it.each([
    'failure',
    'timed_out',
    'cancelled',
    'action_required',
    'startup_failure',
  ])(
    'counts a %s conclusion as failed, as the Reviews board does',
    (conclusion) => {
      expect(
        summarizeChecks([check('build', 'completed', conclusion)])
      ).toEqual({
        failed: 1,
        pending: 0,
        passed: 0,
      });
    }
  );

  it('counts nothing for no checks', () => {
    expect(summarizeChecks([])).toEqual({ failed: 0, pending: 0, passed: 0 });
  });
});

describe('orderChecks', () => {
  it('lists failed checks first, then pending ones, keeping GitHub order within each', () => {
    expect(orderChecks(CHECKS).map((c) => c.name)).toEqual([
      'unit tests',
      'deploy',
      'queued',
      'browser tests',
      'typecheck',
      'preview',
      'lint',
    ]);
  });

  it('leaves the given list unchanged', () => {
    const names = CHECKS.map((c) => c.name);
    orderChecks(CHECKS);
    expect(CHECKS.map((c) => c.name)).toEqual(names);
  });
});
