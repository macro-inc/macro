import type { GithubPullRequestCheckRun } from '@service-storage/generated/schemas';

export type CheckOutcome = 'failed' | 'running' | 'passed' | 'other';

export type ChecksSummary = Record<Exclude<CheckOutcome, 'other'>, number>;

export function checkOutcome(check: GithubPullRequestCheckRun): CheckOutcome {
  if (check.status !== 'completed') return 'running';
  if (check.conclusion === 'success') return 'passed';
  if (check.conclusion === 'failure' || check.conclusion === 'timed_out') {
    return 'failed';
  }
  return 'other';
}

export function summarizeChecks(
  checks: GithubPullRequestCheckRun[]
): ChecksSummary {
  const summary: ChecksSummary = { failed: 0, running: 0, passed: 0 };
  for (const check of checks) {
    const outcome = checkOutcome(check);
    if (outcome !== 'other') summary[outcome] += 1;
  }
  return summary;
}

const OUTCOME_ORDER: Record<CheckOutcome, number> = {
  failed: 0,
  running: 1,
  passed: 2,
  other: 2,
};

/** Failed checks first, then running ones, each group in GitHub's order. */
export function orderChecks(
  checks: GithubPullRequestCheckRun[]
): GithubPullRequestCheckRun[] {
  return [...checks].sort(
    (a, b) => OUTCOME_ORDER[checkOutcome(a)] - OUTCOME_ORDER[checkOutcome(b)]
  );
}
