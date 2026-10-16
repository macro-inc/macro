/** A check run, as far as merge readiness needs it. */
export type PullRequestCheck = {
  status?: string | null;
  conclusion?: string | null;
};

/** Finished conclusions that do not fail the head commit. */
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/**
 * Merge is offered for an open pull request that is not a draft and whose
 * checks have all finished without failing. No checks, a check still running,
 * or a failing check is not passing CI.
 */
export function pullRequestReadyToMerge(input: {
  status: string | null | undefined;
  draft?: boolean | null;
  checks?: readonly PullRequestCheck[] | null;
}): boolean {
  if (input.status !== 'open' || input.draft === true) return false;
  const checks = input.checks;
  if (!checks || checks.length === 0) return false;
  return checks.every(
    (check) =>
      check.status === 'completed' &&
      check.conclusion != null &&
      PASSING_CONCLUSIONS.has(check.conclusion)
  );
}
