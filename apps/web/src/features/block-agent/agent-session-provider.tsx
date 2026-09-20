/** App-facing composition for the agent session and its controllers. */

import { toast } from '@core/component/Toast/Toast';
import { isCodexBotId } from '@core/constant/codexAgent';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { useAgentSessionExternalUrlQuery } from '@queries/agent-session/session';
import type {
  AgentAction,
  AgentSessionResponse,
} from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  createEffect,
  type ParentProps,
  Suspense,
} from 'solid-js';
import { AgentSessionContext } from './context/AgentSessionContext';
import { createAgentSession } from './context/create-agent-session';
import {
  createQueueController,
  type QueueController,
} from './context/create-queue-controller';
import { resolveSessionId } from './context/resolve-session-id';
import { createInteractionController } from './primitives/create-interaction-controller';
import type { QuoteInsert } from './ui';

export function AgentSessionProvider(
  props: ParentProps & {
    /** The block's id: a session, or a placeholder for one being created. */
    blockId: string;
    /** The real id, once known — the block adopts it into the URL. */
    onSessionId?: (sessionId: string) => void;
  }
) {
  const { sessionId, pending, failed, error } = resolveSessionId(
    () => props.blockId
  );

  createEffect(() => {
    const id = sessionId();
    if (id && id !== props.blockId) props.onSessionId?.(id);
  });

  const userId = useUserId();
  const live = createAgentSession(sessionId, { userId });
  const turn = () => live.metadata()?.turn ?? 'idle';
  const served = createQueueController({
    sessionId,
    messages: live.messages,
  });
  // A row the user removes may be one `sendNext` already showed as sent;
  // the fold has to forget it too, or it stays a bubble the log never fills.
  const queue: QueueController = {
    ...served,
    remove: (actionId) => {
      live.retract(actionId);
      return served.remove(actionId);
    },
  };
  const sendNext = () => {
    const head = queue.entries()[0];
    if (!head) return;
    const action: AgentAction | undefined =
      head.kind === 'prompt' && head.prompt != null
        ? { type: 'prompt', prompt: head.prompt }
        : head.kind === 'compact'
          ? { type: 'compact' }
          : undefined;
    void live.issue({ type: 'stop' })?.then((result) => {
      if (result.isErr()) live.retract(head.actionId);
    });
    if (action) live.expect(head.actionId, action);
  };
  const interactions = createInteractionController({
    sessionId,
    pending: () => live.metadata()?.pendingInteractions ?? [],
    canEdit: () => live.session()?.canEdit,
    issue: live.issue,
    onFailure: toast.failure,
  });

  // The transcript's "Reply to this" chip hands selected text to the
  // composer through here. A plain variable, not a signal: it is only read
  // at call time, never rendered from.
  let quoteInsert: QuoteInsert | undefined;
  const registerQuoteInsert = (insert: QuoteInsert | undefined) => {
    quoteInsert = insert;
  };
  const quoteSelection: QuoteInsert = (text) => quoteInsert?.(text);

  return (
    <>
      {/* Nested so a pending poll cannot take the block orchestrator's
          <Suspense fallback={<LoadingBlock />}> and blank the transcript.
          The poll component gates on `isSuccess` so it should not suspend;
          this boundary is the backstop if a read of `query.data` ever does. */}
      <Suspense fallback={null}>
        <CloudExternalUrlPoll
          sessionId={sessionId}
          session={live.session}
          applySnapshot={live.applySnapshot}
        />
      </Suspense>
      <AgentSessionContext.Provider
        value={{
          userId,
          displayName: idToDisplayName,
          sessionId,
          pending,
          startupError: error,
          session: live.session,
          bot: live.bot,
          metadata: live.metadata,
          messages: live.messages,
          // A create that failed leaves the block with nothing to load, which
          // is the same dead end for the reader as a load that failed.
          loadFailed: () => live.loadFailed() || failed(),
          loadRetryable: live.loadFailed,
          retryLoad: live.retry,
          turn,
          issue: live.issue,
          sendNext,
          interactions,
          queue,
          quoteSelection,
          registerQuoteInsert,
        }}
      >
        {props.children}
      </AgentSessionContext.Provider>
    </>
  );
}

/**
 * Compensating read for a cloud session whose provider URL arrived after
 * the feed's snapshot. Lives in its own Suspense so the rest of the block
 * stays mounted while this query's first fetch is in flight.
 */
function CloudExternalUrlPoll(props: {
  sessionId: Accessor<string | undefined>;
  session: Accessor<AgentSessionResponse | undefined>;
  applySnapshot: (session: AgentSessionResponse) => void;
}) {
  // Only a loaded cloud session whose provider URL is still missing polls;
  // everything else passes `undefined`, which disables the query.
  const query = useAgentSessionExternalUrlQuery(() => {
    const id = props.sessionId();
    const session = props.session();
    if (!id || !session || session.external?.url) return undefined;
    return isCursorBotId(session.botId) ||
      isCodexBotId(session.botId) ||
      session.harness === 'claude-cloud'
      ? id
      : undefined;
  });
  createEffect(() => {
    // `query.data` suspends while pending and throws once it errors
    // (`useFavoritesData`). Gate on success so neither reaches the
    // orchestrator Suspense / an error boundary.
    if (!query.isSuccess) return;
    const snapshot = query.data;
    if (!snapshot?.external?.url) return;
    props.applySnapshot(snapshot);
  });
  return null;
}
