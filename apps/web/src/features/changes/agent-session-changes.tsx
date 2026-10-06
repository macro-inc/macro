/**
 * Agent-session adapter for the shared Changes feature.
 *
 * Only this entry reads AgentSessionContext, gates harness queries, and enables
 * prompt-based note sending. Shared UI and controller setup live in changes.tsx.
 */

import { isCoderHarness } from '@app/features/agents-view/core/agent-kind';
import { toast } from '@core/component/Toast/Toast';
import type { ParentProps } from 'solid-js';
import { useAgentSession } from '../block-agent/context/AgentSessionContext';
import { createBrowserChangesActions } from './browser-host';
import { ChangesProvider } from './changes';
import type { ChangesHost } from './context/changes-context';
import { createPullRequestStatsSource } from './queries/pull-request-stats';
import { createSessionChangesSource } from './queries/session-changes';

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
  const pullRequestStats = createPullRequestStatsSource(
    () => (coding() && session.userId() ? pullRequestUrl() : undefined),
    () => source.summary()?.changeset?.id
  );
  const host: ChangesHost = {
    pullRequestChangeCounts: () => pullRequestStats()?.counts,
    pullRequestTitle: () => pullRequestStats()?.title,
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
    ...createBrowserChangesActions(),
  };
  return (
    <ChangesProvider context={{ source, host }}>
      {props.children}
    </ChangesProvider>
  );
}

export type { ReviewNote as LegacyReviewNote } from './core/review-notes';
// Preserve unsent local notes when the dedicated reader replaces the old pane.
export { createReviewState as createLegacyReviewState } from './primitives/create-review-state';
