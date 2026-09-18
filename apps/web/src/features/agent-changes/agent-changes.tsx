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
import { createSignal, type ParentProps } from 'solid-js';
import { useAgentSession } from '../block-agent/context/AgentSessionContext';
import type { ChangesHost } from './context/agent-changes-context';
import { AgentChangesControllerProvider } from './context/agent-changes-controller';
import { createAgentChanges } from './primitives/create-agent-changes';
import { createUrlDiffState } from './primitives/create-url-diff-state';
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
  const urlState = createUrlDiffState(session.sessionId);
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context: { source, host },
    paneLayout: [urlState.layout, urlState.setLayout],
    diffStyle: [urlState.diffStyle, urlState.setDiffStyle],
    dismissed: [dismissed, (id) => setDismissed(id)],
  });
  return (
    <AgentChangesControllerProvider value={controller}>
      {props.children}
    </AgentChangesControllerProvider>
  );
}
