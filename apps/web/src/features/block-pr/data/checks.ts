import type { GithubPullRequestCheckRun } from '@service-storage/generated/schemas';

/** Finished conclusions that fail the head commit. */
export const FAILING_CHECK_CONCLUSIONS: ReadonlySet<string> = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

export type CheckOutcome = 'failed' | 'pending' | 'passed' | 'other';

export type ChecksSummary = Record<Exclude<CheckOutcome, 'other'>, number>;

export function checkOutcome(check: GithubPullRequestCheckRun): CheckOutcome {
  if (check.status !== 'completed') return 'pending';
  if (check.conclusion === 'success') return 'passed';
  if (check.conclusion && FAILING_CHECK_CONCLUSIONS.has(check.conclusion)) {
    return 'failed';
  }
  return 'other';
}

export function summarizeChecks(
  checks: GithubPullRequestCheckRun[]
): ChecksSummary {
  const summary: ChecksSummary = { failed: 0, pending: 0, passed: 0 };
  for (const check of checks) {
    const outcome = checkOutcome(check);
    if (outcome !== 'other') summary[outcome] += 1;
  }
  return summary;
}

const OUTCOME_ORDER: Record<CheckOutcome, number> = {
  failed: 0,
  pending: 1,
  passed: 2,
  other: 2,
};

/** Failed checks first, then pending ones, each group in GitHub's order. */
export function orderChecks(
  checks: GithubPullRequestCheckRun[]
): GithubPullRequestCheckRun[] {
  return [...checks].sort(
    (a, b) => OUTCOME_ORDER[checkOutcome(a)] - OUTCOME_ORDER[checkOutcome(b)]
  );
}
