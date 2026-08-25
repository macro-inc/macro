/**
 * Live per-session state for list surfaces, derived from the shared fold.
 *
 * The agents list renders many sessions at once and wants each row to move
 * as its session does — title, status, working, outstanding permission
 * requests — without refetching Soup. Every one of those is a projection of
 * the session log, and `session-fold.ts` already maintains a shared,
 * refcounted fold per session fed by the `agent_session_log` gateway stream.
 * This module watches that fold for each listed session and publishes the
 * few fields a row needs into one reactive store.
 *
 * Watching is intentionally the caller's move (`watchAgentSessionLive`), not
 * a side effect of reading: acquiring a fold fetches the session's persisted
 * log, so a surface should only watch sessions it actually shows and that
 * can still change — the agents view watches its listed, still-connected
 * sessions and nothing else.
 */

import { lastTurnMessage } from '@app/features/block-agent/state/control-message';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { createStore, produce } from 'solid-js/store';
import { acquireAgentSessionFold } from './session-fold';

/** The row-relevant projection of one session's fold. */
export type AgentSessionLiveState = {
  /** Session title, null until the harness reports one. */
  title: string | null;
  /**
   * The last system event's wire name (`acp_ready`, `disconnected`), null
   * until the runtime reports one — the same projection the backend keeps
   * in the session row's status column, followed live.
   */
  statusEvent: string | null;
  /** The newest turn is unanswered or unfinished — the agent is working. */
  working: boolean;
  /** Outstanding permission requests — asked and not yet answered. */
  pendingPermissionCount: number;
};

type Watch = {
  /** Folded messages by identity, unordered — derivation scans, not renders. */
  messages: Map<string, FoldedMessage>;
  metadata: SessionMetadata | undefined;
  references: number;
  /** The fold acquisition's release, absent until the acquire resolves. */
  release?: () => void;
  closed: boolean;
};

const watches = new Map<string, Watch>();

const [liveStates, setLiveStates] = createStore<
  Record<string, AgentSessionLiveState>
>({});

/**
 * The live state for one session, reactive. Undefined until something
 * watches the session and its fold's first snapshot lands.
 */
export function agentSessionLiveState(
  agentSessionId: string
): AgentSessionLiveState | undefined {
  return liveStates[agentSessionId];
}

/** A folded message's identity: session-local turn plus author kind. */
function messageKey(message: FoldedMessage): string {
  return `${message.turn}:${message.author.kind}`;
}

/**
 * Derive the row-relevant state from a fold's messages and metadata. Pure.
 *
 * A disconnected session is neither working nor waiting on anyone: its
 * unanswered turn will never finish and its pending permission requests can
 * never be answered, so both read as settled — mirroring the backend fold,
 * which invalidates its pending set at connection boundaries.
 */
export function deriveAgentSessionLiveState(
  messages: Iterable<FoldedMessage>,
  metadata: SessionMetadata | undefined
): AgentSessionLiveState {
  const statusEvent = metadata?.status ?? null;
  const disconnected = statusEvent === 'disconnected';

  let working = false;
  let pendingPermissionCount = 0;
  if (!disconnected) {
    // Prompt before reply within a turn, same order the transcript renders.
    const ordered = [...messages].sort((a, b) =>
      a.turn === b.turn
        ? (a.author.kind === 'user' ? 0 : 1) -
          (b.author.kind === 'user' ? 0 : 1)
        : a.turn - b.turn
    );
    const last = lastTurnMessage(ordered);
    working =
      last !== undefined && (last.author.kind === 'user' || last.stop == null);
    for (const message of ordered) {
      for (const part of message.parts) {
        if (part.kind === 'permission' && part.outcome.kind === 'pending') {
          pendingPermissionCount += 1;
        }
      }
    }
  }

  return {
    title: metadata?.title ?? null,
    statusEvent,
    working,
    pendingPermissionCount,
  };
}

function publish(agentSessionId: string, watch: Watch): void {
  setLiveStates(
    agentSessionId,
    deriveAgentSessionLiveState(watch.messages.values(), watch.metadata)
  );
}

async function open(agentSessionId: string, watch: Watch): Promise<void> {
  try {
    const fold = await acquireAgentSessionFold({
      agentSessionId,
      onChange: (messages) => {
        if (watch.closed) return;
        for (const message of messages) {
          watch.messages.set(messageKey(message), message);
        }
        publish(agentSessionId, watch);
      },
      onMetadata: (metadata) => {
        if (watch.closed) return;
        watch.metadata = metadata;
        publish(agentSessionId, watch);
      },
    });
    if (watch.closed) {
      fold.release();
      return;
    }
    watch.release = fold.release;
    for (const message of fold.messages) {
      watch.messages.set(messageKey(message), message);
    }
    watch.metadata = fold.metadata;
    publish(agentSessionId, watch);
  } catch (error) {
    // Leave current watchers holding the dead record; dropping it from the
    // map lets the next watch retry the acquisition from scratch.
    if (!watch.closed && watches.get(agentSessionId) === watch) {
      watches.delete(agentSessionId);
    }
    console.error('[agent-live] session fold could not be acquired', error);
  }
}

/**
 * Follow one session's fold and keep its `agentSessionLiveState` current.
 *
 * Refcounted per session across callers, sharing the underlying fold with
 * any open session block. Call the returned release exactly once; the last
 * release lets the fold go and clears the session's live state.
 */
export function watchAgentSessionLive(agentSessionId: string): () => void {
  let watch = watches.get(agentSessionId);
  if (!watch) {
    watch = {
      messages: new Map(),
      metadata: undefined,
      references: 0,
      closed: false,
    };
    watches.set(agentSessionId, watch);
    void open(agentSessionId, watch);
  }
  watch.references += 1;
  const acquired = watch;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    acquired.references -= 1;
    if (acquired.references > 0) return;
    acquired.closed = true;
    if (watches.get(agentSessionId) === acquired) {
      watches.delete(agentSessionId);
    }
    acquired.release?.();
    setLiveStates(
      produce((states) => {
        delete states[agentSessionId];
      })
    );
  };
}
