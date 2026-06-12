/**
 * The notification event tags emitted for GitHub pull request activity.
 *
 * Kept in a dependency-free module so display helpers (and their tests) can
 * import it without pulling in the notification source's client-only graph.
 */
export const GITHUB_EVENT_TYPES = [
  'github_pr_status_changed',
  'github_review_requested',
  'github_pr_comment',
  'github_pr_mention',
  'github_pr_review',
] as const;
