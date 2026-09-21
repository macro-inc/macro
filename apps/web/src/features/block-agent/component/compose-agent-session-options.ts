import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';

/** Title-case a harness slug when nothing names it (`claude-code` → `Claude Code`). */
function titledHarness(harness: string): string {
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * User-facing name for the runtime a persona runs on. Harness ids are
 * plumbing (`in-memory`, `macro-inmem`); the product name is Macro Agent.
 */
export function harnessDisplayName(harness: string): string {
  switch (harness) {
    case 'in-memory':
    case 'macro-inmem':
    case 'sandbox':
      return MACRO_HARNESS_NAME;
    case 'cursor':
      return 'Cursor';
    case 'codex-cloud':
      return 'Codex';
    case 'claude-cloud':
      return 'Claude Cloud';
    default:
      return harness;
  }
}

/**
 * Label for a session's harness. Macro slugs would otherwise title-case to
 * "Macro Inmem" / "In Memory"; everything else stays a titled slug.
 */
export function harnessTitle(harness: string | undefined): string {
  if (!harness) return 'Agent session';
  if (
    harness === 'in-memory' ||
    harness === 'macro-inmem' ||
    harness === 'sandbox'
  ) {
    return MACRO_HARNESS_NAME;
  }
  return titledHarness(harness);
}

/** A model's display name, or its id when the runtime lists no name for it. */
export function modelDisplayName(
  id: string,
  available: readonly { id: string; name: string }[]
): string {
  return available.find((model) => model.id === id)?.name ?? id;
}
