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
import { createSessionChangesSource } from './queries/session-changes';
import { createUrlDiffState } from './url-diff-state';

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
  const sendPrompt = async (markdown: string) => {
    try {
      const result = await session.issue({ type: 'prompt', prompt: markdown });
      if (!result || result.isErr()) {
        toast.failure('The review notes could not be sent');
      }
    } catch {
      toast.failure('The review notes could not be sent');
    }
  };
  const host: ChangesHost = {
    scopeKey: session.sessionId,
    agent: {
      send: (markdown) => void sendPrompt(markdown),
      canSend: () =>
        session.sessionId() !== undefined &&
        !session.loadFailed() &&
        (session.session()?.canEdit ?? true),
    },
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
