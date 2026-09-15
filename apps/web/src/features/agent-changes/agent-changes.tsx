/**
 * Production entry point for the Changes pane.
 *
 * Builds the controller from the real adapters: the agent-harness changes
 * queries, and the surrounding agent-session block for posting prompts and
 * reading the linked pull request. Hosts mount `AgentChangesProvider`
 * inside `AgentSessionProvider`, then place the split, the toggle, the
 * hand-off card, and the notes chip where they belong.
 */

import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal, type ParentProps } from 'solid-js';
import { useAgentSession } from '../block-agent/context/AgentSessionContext';
import type { ChangesHost } from './context/agent-changes-context';
import { AgentChangesControllerProvider } from './context/agent-changes-controller';
import {
  createAgentChanges,
  type DiffStyle,
} from './primitives/create-agent-changes';
import { createSessionChangesSource } from './queries/session-changes';

export { AgentChangesSplit } from './views/AgentChangesSplit';
export {
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from './views/SessionChangesControls';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AgentChangesProvider(props: ParentProps) {
  const session = useAgentSession();
  const source = createSessionChangesSource(session.sessionId);
  const host: ChangesHost = {
    sessionId: session.sessionId,
    sendToAgent: session.composer.send,
    canSend: () =>
      session.sessionId() !== undefined &&
      !session.loadFailed() &&
      (session.session()?.canEdit ?? true),
    working: session.working,
    pullRequestUrl: () => session.session()?.pullRequestUrl ?? undefined,
    openExternal: openExternalUrl,
    copyText,
    notify: (message, tone) => {
      if (tone === 'success') toast.success(message);
      else toast.failure(message);
    },
  };
  // The layout preference is the reviewer's, not the session's.
  const [diffStyle, setDiffStyle] = makePersisted(
    createSignal<DiffStyle>('unified'),
    { name: 'agent-changes:diff-style' }
  );
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context: { source, host },
    diffStyle: [diffStyle, (style) => setDiffStyle(style)],
    dismissed: [dismissed, (id) => setDismissed(id)],
  });
  return (
    <AgentChangesControllerProvider value={controller}>
      {props.children}
    </AgentChangesControllerProvider>
  );
}
