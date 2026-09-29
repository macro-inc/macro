import { isCoderHarness } from '@app/features/agents-view/core/agent-kind';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { isClaudeBotId } from '@core/constant/claudeAgent';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';

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

/** Title-case a harness slug when nothing names it (`claude-code` → `Claude Code`). */
function titledHarness(harness: string): string {
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
 * Session Details lists a harness only for coding runtimes. In-memory chat
 * agents have no user-facing harness, so the row stays off. Uses the same
 * slug as `sessionHarnessTitle` so a first-party coding bot still shows even
 * when an older row was stamped `opencode`.
 */
export function showsSessionHarness(session: {
  harness?: string;
  botId?: string;
}): boolean {
  return isCoderHarness(sessionHarnessSlug(session));
}

/**
 * A model's display name. Runtimes that keep no name for a model report its
 * slug as the name, so the house label reads the id instead of showing
 * `claude-sonnet-5` where the rest of the app says "Sonnet 5".
 */
export function modelDisplayName(
  id: string,
  available: readonly { id: string; name: string }[]
): string {
  return modelLabel(id, available.find((model) => model.id === id)?.name);
}
