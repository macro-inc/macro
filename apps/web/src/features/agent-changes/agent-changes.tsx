/**
 * Production entry point for the Changes pane.
 *
 * Builds the controller from the real adapters: the agent-harness changes
 * queries, and the surrounding agent-session block for posting prompts and
 * reading the linked pull request. Hosts mount `AgentChangesProvider`
 * inside `AgentSessionProvider`, then place the split, the toggle, the
 * hand-off card, and the notes chip where they belong.
 */

import { isCoderHarness } from '@app/features/agents-view/core/agent-kind';
import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import { createSignal, type ParentProps } from 'solid-js';
import { useAgentSession } from '../block-agent/context/AgentSessionContext';
import type { ChangesHost } from './context/agent-changes-context';
import { AgentChangesControllerProvider } from './context/agent-changes-controller';
import { createPaneViewState } from './pane-view-state';
import { createAgentChanges } from './primitives/create-agent-changes';
import { createPullRequestStatsSource } from './queries/pull-request-stats';
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
  const pullRequestUrl = () => session.session()?.pullRequestUrl ?? undefined;
  // Only a coding harness has a repository to diff; a chat-only session
  // (in-memory) never fetches changes and shows none of the GitHub chrome.
  const coding = () => isCoderHarness(session.session()?.harness);
  // The harness captures a session's changeset from its linked pull
  // request, so until one is linked there is nothing to fetch or show.
  const canHaveChanges = () => coding() && pullRequestUrl() !== undefined;
  const source = createSessionChangesSource(() =>
    canHaveChanges() ? session.sessionId() : undefined
  );
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
  const pullRequestChangeCounts = createPullRequestStatsSource(
    () => (coding() && session.userId() ? pullRequestUrl() : undefined),
    () => source.summary()?.changeset?.id
  );
  const host: ChangesHost = {
    pullRequestChangeCounts,
    scopeKey: session.sessionId,
    agent: {
      send: (markdown) => void sendPrompt(markdown),
      canSend: () =>
        session.sessionId() !== undefined &&
        !session.loadFailed() &&
        (session.session()?.canEdit ?? true),
    },
    canHaveChanges,
    pullRequestUrl,
    openExternal: openExternalUrl,
    copyText,
    notify: (message, tone) => {
      if (tone === 'success') toast.success(message);
      else toast.failure(message);
    },
  };
  const view = createPaneViewState();
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context: { source, host },
    view,
    dismissed: [dismissed, (id) => setDismissed(id)],
  });
  return (
    <AgentChangesControllerProvider value={controller}>
      {props.children}
    </AgentChangesControllerProvider>
  );
}

export type { ReviewNote as LegacyReviewNote } from './core/review-notes';
// Preserve unsent local notes when the dedicated reader replaces the old pane.
export { createReviewState as createLegacyReviewState } from './primitives/create-review-state';
