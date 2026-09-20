import { isCursorBotId } from '@core/constant/cursorAgent';

/** 'claude-code' → 'Claude Code'; the fallback when nothing names a harness. */
export function harnessTitle(harness: string | undefined): string {
  if (!harness) return 'Agent session';
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The harness label a session should show. Cursor sessions are always
 * Cursor, even when an older row was stamped with the sandboxed-coder
 * default (`opencode`).
 */
export function sessionHarnessTitle(session: {
  harness?: string;
  botId?: string;
}): string {
  if (isCursorBotId(session.botId)) return harnessTitle('cursor');
  return harnessTitle(session.harness);
}

/**
 * User-facing name for the runtime a persona runs on. Harness ids are
 * plumbing ("in-memory", "sandbox"); the product names are the coders.
 */
export function harnessDisplayName(harness: string): string {
  switch (harness) {
    case 'in-memory':
    case 'macro-inmem':
    case 'sandbox':
      return 'Macro';
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

/** A model's display name, or its id when the runtime lists no name for it. */
export function modelDisplayName(
  id: string,
  available: readonly { id: string; name: string }[]
): string {
  return available.find((model) => model.id === id)?.name ?? id;
}
