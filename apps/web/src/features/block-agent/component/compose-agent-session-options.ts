import { isCoderHarness } from '@app/features/agents-view/core/agent-kind';
import { isClaudeBotId } from '@core/constant/claudeAgent';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';

/**
 * The repository a session works in, for the header menu and side panel.
 * The service stamps the deployment's default repository on every session,
 * including chat-only ones that never touch it, so only a coding harness
 * gets to show one.
 */
export function sessionRepositoryUrl(
  session: { harness: string; repoUrl?: string | null } | undefined
): string | undefined {
  if (!session || !isCoderHarness(session.harness)) return undefined;
  return session.repoUrl ?? undefined;
}

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
 * The harness slug a session should be labeled with. First-party cloud bots
 * own a fixed slug (Cursor / Codex / Claude Cloud), even when an older row
 * was stamped with the sandboxed-coder default (`opencode`).
 */
export function sessionHarnessSlug(session: {
  harness?: string;
  botId?: string;
}): string | undefined {
  const botId = session.botId;
  if (botId && isCursorBotId(botId)) return 'cursor';
  if (botId && isCodexBotId(botId)) return 'codex-cloud';
  if (botId && isClaudeBotId(botId)) return 'claude-cloud';
  return session.harness;
}

/** Title-cased harness label for session chrome (side panel, fallback title). */
export function sessionHarnessTitle(session: {
  harness?: string;
  botId?: string;
}): string {
  return harnessTitle(sessionHarnessSlug(session));
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
