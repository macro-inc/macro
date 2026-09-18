import { isCodexBotId } from '@core/constant/codexAgent';

/**
 * Block-level state for the agent block, following the chat block's
 * `ChatInputProvider`/`useChatInputContext` convention: the provider owns the
 * session and its controllers, composer/container components consume them
 * from context, and the `ui/` leaves stay dumb — they only ever receive
 * derived props.
 *
 * The session itself is `createAgentSession`, the Solid face of the shared
 * `AgentSession` class: one machine per session, speculation inside it, so
 * everything about "what is the agent doing" is read off the fold's
 * `metadata.turn` and the messages' `pending` marks rather than kept here.
 */

import type { IssueResult } from '@core/agent-session/AgentSession';
import { isCursorBotId } from '@core/constant/cursorAgent';
import { useUserId } from '@core/context/user';
import { useAgentSessionExternalUrlQuery } from '@queries/agent-session/session';
import type {
  FoldedMessage,
  SessionMetadata,
  TurnState,
} from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  createContext,
  createEffect,
  type ParentProps,
  Suspense,
  useContext,
} from 'solid-js';
import type { QuoteInsert } from '../ui';
import { createAgentSession } from './create-agent-session';
import {
  createElicitationController,
  type ElicitationController,
} from './create-elicitation-controller';
import {
  createQueueController,
  type QueueController,
} from './create-queue-controller';
import { resolveSessionId } from './resolve-session-id';

export type AgentSessionState = {
  /**
   * The session this block shows, absent while a just-created one's `POST`
   * is still on the wire. See `pending-session.ts`.
   */
  sessionId: Accessor<string | undefined>;
  /** The session is still being created — everything else is empty because
   *  there is nothing to show yet, not because the load failed. */
  pending: Accessor<boolean>;
  startupError: Accessor<string | undefined>;
  /** Session metadata, absent until the load resolves. */
  session: Accessor<AgentSessionResponse | undefined>;
  /** The bot the session runs as, absent until the fold is acquired. */
  bot: Accessor<SessionBot | undefined>;
  /** The fold's session metadata (title, model, turn, …), followed live. */
  metadata: Accessor<SessionMetadata | undefined>;
  /** The folded transcript, ordered by turn, live-following the session. */
  messages: Accessor<FoldedMessage[]>;
  loadFailed: Accessor<boolean>;
  /**
   * Retry can re-run the failed load. False when the create itself failed —
   * there is no session to refetch, so offering Retry would do nothing.
   */
  loadRetryable: Accessor<boolean>;
  /** Re-runs a failed load. */
  retryLoad: () => void;
  /**
   * Where the newest turn stands, as the fold reports it: the block's one
   * answer to "what is the agent doing". Every consumer — composer, working
   * line, chrome — reads this discriminant, never the transcript's tail or
   * its own record of what it posted, so the block cannot disagree with
   * itself. `idle` until the fold has loaded.
   */
  turn: Accessor<TurnState>;
  /**
   * Do something to the agent: prompt, stop, change model. The fold shows
   * the action at once and the log settles it. `undefined` while the block
   * has no session to act on.
   */
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  /**
   * Send the next queued message now: stop the running turn, and show the
   * queue head as sent under the id the server already holds it by. The
   * server dispatches it when the turn actually ends, and that row promotes
   * the speculation in place. No-op with nothing queued.
   */
  sendNext: () => void;
  /** The live question, and the action that answers it. */
  elicitation: ElicitationController;
  /**
   * The session's server-side action queue: prompts sent mid-turn wait
   * there and dispatch one per turn end. The server is the only truth —
   * nothing is queued client-side.
   */
  queue: QueueController;
  /**
   * Quote selected transcript text into the composer as a referenced paste
   * chip. No-op until the composer editor has mounted.
   */
  quoteSelection: QuoteInsert;
  /** The composer registers its quote-insert handler here on mount. */
  registerQuoteInsert: (insert: QuoteInsert | undefined) => void;
};

const AgentSessionCtx = createContext<AgentSessionState>();

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
  // A question the connection that asked is gone cannot be answered; the
  // fold keeps the part but the slot is dead.
  const pendingElicitation = () =>
    turn() === 'disconnected'
      ? undefined
      : (live.metadata()?.pendingElicitation ?? undefined);
  const elicitation = createElicitationController({
    pending: pendingElicitation,
    canEdit: () => live.session()?.canEdit,
    issue: live.issue,
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
      <AgentSessionCtx.Provider
        value={{
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
          elicitation,
          queue,
          quoteSelection,
          registerQuoteInsert,
        }}
      >
        {props.children}
      </AgentSessionCtx.Provider>
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

export function useAgentSession(): AgentSessionState {
  const ctx = useContext(AgentSessionCtx);
  if (!ctx) {
    throw new Error(
      'useAgentSession must be used within <AgentSessionProvider />'
    );
  }
  return ctx;
}
