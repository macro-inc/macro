import { isCoderHarness } from '@app/features/agents-view/core/agent-kind';

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
