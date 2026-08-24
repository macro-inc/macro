/** 'claude-code' → 'Claude Code'; the fallback name when a session has no
 * agent-reported title. Shared by the split header and the unified list. */
export function harnessTitle(harness: string | undefined): string {
  if (!harness) return 'Agent session';
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
