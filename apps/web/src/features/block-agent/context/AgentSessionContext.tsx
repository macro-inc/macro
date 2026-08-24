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
  useContext,
} from 'solid-js';
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
  });

  // Anything the service can only deliver over a live transport: a prompt on
  // the wire, or a model change waiting to be seen in the fold.
  const awaitingRuntime = () =>
    composer.sendingId() !== undefined ||
    composer.changingModel() !== undefined;
  const resuming = () => isDisconnected(status.status()) && awaitingRuntime();

  return (
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
        working,
        status: status.status,
        resuming,
        composer,
      }}
    >
      {props.children}
    </AgentSessionCtx.Provider>
  );
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
