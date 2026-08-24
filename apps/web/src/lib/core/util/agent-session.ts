/**
 * Display helpers for agent sessions, shared between the session block and
 * the unified list.
 */

/** 'claude-code' → 'Claude Code'; the fallback when a session has no title. */
export function harnessTitle(harness: string | undefined): string {
  if (!harness) return 'Agent session';
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The repository name from a session's repo URL, for a compact badge.
 * `https://github.com/macro-inc/macro.git` → `macro-inc/macro`. */
export function repoNameFromUrl(
  repoUrl: string | undefined
): string | undefined {
  if (!repoUrl) return undefined;
  const trimmed = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length < 2) return undefined;
  const [owner, repo] = segments.slice(-2);
  // Guard against protocol fragments when the URL has no path.
  if (!owner || !repo || owner.includes(':')) return repo || undefined;
  return `${owner}/${repo}`;
}
