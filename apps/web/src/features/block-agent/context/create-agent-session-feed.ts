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

import { isCursorBotId } from '@core/constant/cursorAgent';
import type { AgentSessionRenamedEvent } from '@queries/agent-session/realtime-protocol';
import { acquireAgentSessionFold } from '@queries/agent-session/session-fold';
import { subscribeAgentSessionRenamed } from '@queries/agent-session/session-metadata-sync';
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
  createEffect,
  createMemo,
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
  /** Re-runs a failed load. */
  retry: () => void;
  /** The newest turn has no stop reason yet — the agent is working. */
  working: Accessor<boolean>;
};

/**
 * How often, and how many times, to re-read a Cursor session's snapshot
 * while its cursor.com url is still missing. Together they span ~30s, which
 * comfortably covers Cursor's agent creation inside the first prompt.
 */
export const EXTERNAL_URL_POLL_INTERVAL_MS = 2_000;
export const EXTERNAL_URL_POLL_ATTEMPTS = 15;

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
  let latestRename: AgentSessionRenamedEvent | undefined;
  let renameRefresh = 0;
  onCleanup(() => {
    closed = true;
    release?.();
    release = undefined;
  });

  const [resource, { mutate, refetch }] = createResource(
    sessionId,
    async (id) => {
      const run = ++generation;
      const renameRefreshAtStart = renameRefresh;
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

      return renameRefresh > renameRefreshAtStart &&
        latestRename?.agentSessionId === id
        ? { ...session.value, name: latestRename.name }
        : session.value;
    }
  );

  onCleanup(
    subscribeAgentSessionRenamed((event) => {
      if (event.agentSessionId !== sessionId()) return;
      const run = ++renameRefresh;
      void agentHarnessServiceClient
        .get(event.agentSessionId)
        .then((session) => {
          if (
            session.isErr() ||
            run !== renameRefresh ||
            event.agentSessionId !== sessionId()
          )
            return;
          latestRename = {
            agentSessionId: event.agentSessionId,
            name: session.value.name,
          };
          mutate((current) =>
            current ? { ...current, name: session.value.name } : current
          );
        });
    })
  );

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

  // The external identity — the Cursor agent's id, name, and the link out to
  // it — is minted by Cursor's API inside the session's *first prompt*, so
  // the snapshot fetched at load never carries it: `create` returns those
  // columns NULL by construction. Nothing announces it on the wire either,
  // so a session opened before the mint must poll the snapshot for it.
  //
  // The url specifically, not the row: the harness writes the row the moment
  // the agent exists, but fills the url from a best-effort follow-up fetch
  // that can fail, and a url-less row is exactly as unopenable as no row.
  // The budget covers a slow mint; a session still url-less past it is that
  // failed follow-up, which no amount of polling can repair.
  // The memo gate keeps the interval from restarting — and the attempts
  // budget from resetting — when the snapshot changes for unrelated reasons
  // (a rename refresh replaces the whole value).
  const sessionAwaitingExternalUrl = createMemo(() => {
    const id = sessionId();
    const session = resource.latest;
    if (!id || !session || session.external?.url) return undefined;
    return isCursorBotId(session.botId) ? id : undefined;
  });
  createEffect(() => {
    const id = sessionAwaitingExternalUrl();
    if (!id) return;
    let attempts = EXTERNAL_URL_POLL_ATTEMPTS;
    let inFlight = false;
    const read = () => {
      if (inFlight) return;
      if (attempts <= 0) {
        clearInterval(timer);
        return;
      }
      attempts -= 1;
      inFlight = true;
      void agentHarnessServiceClient.get(id).then((refreshed) => {
        inFlight = false;
        if (refreshed.isErr() || closed || sessionId() !== id) return;
        if (!refreshed.value.external?.url) return;
        // Landing the url flips the gate, so the interval is cleaned up
        // rather than polling on.
        mutate(refreshed.value);
      });
    };
    const timer = setInterval(read, EXTERNAL_URL_POLL_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
    read();
  });

  return {
    session: () => resource.latest,
    bot,
    metadata,
    messages,
    loadFailed: () => resource.error !== undefined,
    retry: () => void refetch(),
    working,
  };
}
