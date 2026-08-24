/**
 * The block's session feed: session metadata plus the shared live fold,
 * exposed as an *ordered* reactive list of folded messages — the shape a
 * linear transcript renders from.
 *
 * The heavy lifting lives in `@queries/agent-session/session-fold`'s
 * `acquireAgentSessionFold`: it buffers realtime frames before fetching the
 * persisted log, folds through one worker machine per session, and
 * refcounts across surfaces. This factory just orders what the fold reports
 * and keeps rows reconciled so a streaming turn updates in place.
 */

import { acquireAgentSessionFold } from '@queries/agent-session/session-fold';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  batch,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { lastTurnMessage } from '../state/control-message';

export type AgentSessionFeed = {
  /** Session metadata, absent until the load resolves. */
  session: Accessor<AgentSessionResponse | undefined>;
  /** The bot the session runs as, absent until the fold is acquired. */
  bot: Accessor<SessionBot | undefined>;
  /** The fold's session metadata (title, model, …), followed live. */
  metadata: Accessor<SessionMetadata | undefined>;
  /** The folded transcript, ordered by turn (prompt before reply). */
  messages: Accessor<FoldedMessage[]>;
  loadFailed: Accessor<boolean>;
  /** The newest turn has no stop reason yet — the agent is working. */
  working: Accessor<boolean>;
};

/** Prompt sorts before reply within a turn. */
function authorRank(message: FoldedMessage): number {
  return message.author.kind === 'user' ? 0 : 1;
}

function compareMessages(a: FoldedMessage, b: FoldedMessage): number {
  if (a.turn !== b.turn) return a.turn - b.turn;
  return authorRank(a) - authorRank(b);
}

function sameMessage(a: FoldedMessage, b: FoldedMessage): boolean {
  return a.turn === b.turn && a.author.kind === b.author.kind;
}

/**
 * `sessionId` is absent while a just-created session's `POST` is still on the
 * wire (`pending-session.ts`). `createResource` treats an absent source as
 * "nothing to fetch", so the block simply renders its empty transcript until
 * the id lands and the fetch runs itself.
 */
export function createAgentSessionFeed(
  sessionId: Accessor<string | undefined>
): AgentSessionFeed {
  const [list, setList] = createStore<FoldedMessage[]>([]);
  const [bot, setBot] = createSignal<SessionBot>();
  const [metadata, setMetadata] = createSignal<SessionMetadata>();

  const upsert = (messages: FoldedMessage[]) =>
    batch(() => {
      for (const message of messages) {
        // The list is short and appends dominate, so scan from the tail
        // rather than binary-searching.
        let index = list.length - 1;
        while (index >= 0 && compareMessages(list[index]!, message) > 0) {
          index--;
        }
        if (index >= 0 && sameMessage(list[index]!, message)) {
          // Path-scoped reconcile: a streaming turn replaces its message
          // hundreds of times; only the changed content re-renders.
          setList(index, reconcile(message));
        } else {
          const at = index + 1;
          setList(
            produce((current: FoldedMessage[]) =>
              current.splice(at, 0, message)
            )
          );
        }
      }
    });

  let release: (() => void) | undefined;

  // A superseded run (session switch, unmount mid-fetch) must release its
  // acquisition or the shared fold leaks a reference.
  let generation = 0;
  let closed = false;
  onCleanup(() => {
    closed = true;
    release?.();
    release = undefined;
  });

  const [resource] = createResource(sessionId, async (id) => {
    const run = ++generation;
    const superseded = () => closed || generation !== run;

    release?.();
    release = undefined;
    batch(() => {
      setList(reconcile([]));
      setBot(undefined);
      setMetadata(undefined);
    });

    const session = await agentHarnessServiceClient.get(id);
    if (session.isErr()) {
      throw new Error(`agent session could not be fetched: ${id}`);
    }
    if (superseded()) return session.value;

    const fold = await acquireAgentSessionFold({
      agentSessionId: id,
      onChange: upsert,
      onMetadata: setMetadata,
    });
    if (superseded()) {
      fold.release();
      return session.value;
    }
    release = fold.release;
    batch(() => {
      setBot(fold.bot);
      setMetadata(fold.metadata);
      upsert(fold.messages);
    });

    return session.value;
  });

  const messages = () => list;
  // A user-authored tail means a prompt is awaiting its reply — except when
  // it is a control, which is user-authored, never gets a stop reason, and
  // starts no turn. Counting one would latch this signal true forever, and
  // the composer's drain holds every prompt behind it: changing the model
  // would silently stop the session from accepting anything again.
  const working = () => {
    const last = lastTurnMessage(list);
    if (!last) return false;
    return last.author.kind === 'user' || last.stop == null;
  };

  return {
    session: () => resource.latest,
    bot,
    metadata,
    messages,
    loadFailed: () => resource.error !== undefined,
    working,
  };
}
