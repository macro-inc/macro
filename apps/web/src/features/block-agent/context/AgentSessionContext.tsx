/**
 * Block-level state for the agent block, following the chat block's
 * `ChatInputProvider`/`useChatInputContext` convention: the provider owns the
 * session data and controllers, composer/container components consume them
 * from context, and the `ui/` leaves stay dumb — they only ever receive
 * derived props.
 *
 * The value is assembled from `create*` factories (CHANNEL_BLOCK_NOTES.md §3)
 * so each stateful concern stays a composable unit as wiring grows.
 */

import { isCursorBotId } from '@core/constant/cursorAgent';
import { useAgentSessionExternalUrlQuery } from '@queries/agent-session/session';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type {
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
import { controlOutcome } from '../state/control-message';
import type { QuoteInsert } from '../ui';
import { createAgentSessionFeed } from './create-agent-session-feed';
import {
  type ComposerController,
  createComposerController,
} from './create-composer-controller';
import {
  createSessionStatusController,
  isDisconnected,
  type SessionStatus,
} from './create-session-status-controller';
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
  /** Session metadata, absent until the load resolves. */
  session: Accessor<AgentSessionResponse | undefined>;
  /** The bot the session runs as, absent until the fold is acquired. */
  bot: Accessor<SessionBot | undefined>;
  /** The fold's session metadata (title, model, …), followed live. */
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
   * The block's one answer to "is the agent working": the fold's
   * turn-in-flight signal, cut off when the runtime is known to be gone.
   * Every consumer — composer, shimmer, header — reads this, never
   * `feed.working` or `status` directly, so the block cannot disagree with
   * itself about whether a turn is running.
   */
  working: Accessor<boolean>;
  /** The runtime's status: the GET snapshot, followed live over the log. */
  status: Accessor<SessionStatus>;
  /**
   * The runtime is gone and the user has asked it for something anyway, so
   * the service is bringing its sandbox back before it can deliver.
   *
   * There is no signal for this on the wire: the resume happens inside the
   * service, and the session log stays silent until the container answers.
   * It is inferred instead, from the one thing the block does know — the
   * runtime was disconnected, and a request it must wait on is outstanding.
   */
  resuming: Accessor<boolean>;
  composer: ComposerController;
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
  const { sessionId, pending, failed } = resolveSessionId(() => props.blockId);

  createEffect(() => {
    const id = sessionId();
    if (id && id !== props.blockId) props.onSessionId?.(id);
  });

  const feed = createAgentSessionFeed(sessionId);
  const status = createSessionStatusController({
    sessionId,
    seed: () => feed.session()?.status,
  });
  // A last message with no stop reason reads as an open turn forever; the
  // status stream knows when the runtime disconnected without closing it.
  // Combining them here is what keeps "working" a single truth.
  const working = () => feed.working() && !isDisconnected(status.status());
  const composer = createComposerController({
    sessionId,
    working,
    model: () => feed.metadata()?.model,
    controlOutcome: (requestId) => controlOutcome(feed.messages(), requestId),
  });

  // The transcript's "Reply to this" chip hands selected text to the
  // composer through here. A plain variable, not a signal: it is only read
  // at call time, never rendered from.
  let quoteInsert: QuoteInsert | undefined;
  const registerQuoteInsert = (insert: QuoteInsert | undefined) => {
    quoteInsert = insert;
  };
  const quoteSelection: QuoteInsert = (text) => quoteInsert?.(text);

  // Anything the service can only deliver over a live transport: a prompt on
  // the wire, or a model change waiting to be seen in the fold.
  const awaitingRuntime = () =>
    composer.sendingId() !== undefined ||
    composer.changingModel() !== undefined;
  const resuming = () => isDisconnected(status.status()) && awaitingRuntime();

  return (
    <>
      {/* Nested so a pending poll cannot take the block orchestrator's
          <Suspense fallback={<LoadingBlock />}> and blank the transcript.
          The poll component gates on `isSuccess` so it should not suspend;
          this boundary is the backstop if a read of `query.data` ever does. */}
      <Suspense fallback={null}>
        <CursorExternalUrlPoll
          sessionId={sessionId}
          session={feed.session}
          applySnapshot={feed.applySnapshot}
        />
      </Suspense>
      <AgentSessionCtx.Provider
        value={{
          sessionId,
          pending,
          session: feed.session,
          bot: feed.bot,
          metadata: feed.metadata,
          messages: feed.messages,
          // A create that failed leaves the block with nothing to load, which
          // is the same dead end for the reader as a load that failed.
          loadFailed: () => feed.loadFailed() || failed(),
          loadRetryable: feed.loadFailed,
          retryLoad: feed.retry,
          working,
          status: status.status,
          resuming,
          composer,
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
 * Compensating read for a Cursor session whose provider url arrived after
 * the feed's snapshot. Lives in its own Suspense so the rest of the block
 * stays mounted while this query's first fetch is in flight.
 */
function CursorExternalUrlPoll(props: {
  sessionId: Accessor<string | undefined>;
  session: Accessor<AgentSessionResponse | undefined>;
  applySnapshot: (session: AgentSessionResponse) => void;
}) {
  // Only a loaded Cursor session whose provider url is still missing polls;
  // everything else passes `undefined`, which disables the query.
  const query = useAgentSessionExternalUrlQuery(() => {
    const id = props.sessionId();
    const session = props.session();
    if (!id || !session || session.external?.url) return undefined;
    return isCursorBotId(session.botId) ? id : undefined;
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
