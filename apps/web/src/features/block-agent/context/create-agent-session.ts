/**
 * The Solid face of {@link AgentSession}: the shared session for whatever id
 * the block currently shows, as a reconciled ordered store of folded messages
 * plus the signals a transcript renders from.
 *
 * Everything stateful about the session lives in the class. This only owns
 * the store, applies fold events to it, and releases the acquisition when
 * the id changes or the owner disposes.
 */

import {
  AgentSession,
  type IssueResult,
} from '@core/agent-session/AgentSession';
import type { AgentSessionRenamedEvent } from '@queries/agent-session/realtime-protocol';
import {
  subscribeAgentSessionRenamed,
  subscribeAgentSessionUpdated,
} from '@queries/agent-session/session-metadata-sync';
import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentAction,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  batch,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';

export type AgentSessionHandle = {
  /** Session row, absent until the load resolves. */
  session: Accessor<AgentSessionResponse | undefined>;
  /** The bot the session runs as, absent until the load resolves. */
  bot: Accessor<SessionBot | undefined>;
  /** The fold's session metadata (title, model, turn, …), followed live. */
  metadata: Accessor<SessionMetadata | undefined>;
  /** The folded transcript, ordered by turn (prompt before reply). */
  messages: Accessor<FoldedMessage[]>;
  loadFailed: Accessor<boolean>;
  /** Re-runs a failed load. */
  retry: () => void;
  /**
   * Do something to the agent. Folded speculatively at once; settled by the
   * log. `undefined` while the block has no session to act on.
   */
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  /**
   * Show a queued action as dispatched under the id the server holds it
   * by. See {@link AgentSession.expect}.
   */
  expect: (actionId: string, action: AgentAction) => void;
  /** Take a speculation back. See {@link AgentSession.retract}. */
  retract: (actionId: string) => void;
  /**
   * Adopt a newer snapshot of this session (the bounded external-url poll).
   * No-op when the payload is for a different session.
   */
  applySnapshot: (session: AgentSessionResponse) => void;
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
 * the id lands and the load runs itself.
 */
export function createAgentSession(
  sessionId: Accessor<string | undefined>,
  options: {
    /** The viewer, so a speculated prompt is attributed as the log will. */
    userId: Accessor<string | undefined>;
  }
): AgentSessionHandle {
  // Whether this block went on screen before it had a session to load.
  //
  // `resource.latest` falls back to a *suspending* read until the resource has
  // resolved once, and suspending hands the block's
  // `<Suspense fallback={<LoadingBlock />}>` a promise: Solid swaps in the
  // fallback, which detaches the whole block subtree and re-attaches it when
  // the fetch lands. A cold open has nothing on screen to lose and wants that
  // skeleton. This block does: it opened on a placeholder minutes before the
  // create resolved, the user has been typing into its composer the whole
  // time, and the detach blanks the transcript and drops the caret to
  // `<body>`. Absent is a state it already renders — that is the whole point
  // of the placeholder — so report that for the first fetch instead.
  const openedPending = sessionId() === undefined;

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

  /** A row's identity in the transcript, and the transcript's render key. */
  const keyOf = (message: FoldedMessage) =>
    `${message.turn}:${message.author.kind}`;

  // A whole new view of the conversation: what a load reports, and what every
  // rebase reports while something is speculated.
  //
  // Merged row by row rather than spliced wholesale. A splice hands the store
  // a fresh object for every index, so Solid remounts every row - the
  // transcript re-measures, entrance motions replay, and a streaming turn
  // visibly jumps. A rebase happens on *every* confirmed frame while an
  // action is pending, so that jump was the whole turn flickering. Reconciling
  // each row against the one already there keeps identity for everything that
  // did not actually change.
  const replace = (messages: FoldedMessage[]) =>
    batch(() => {
      const wanted = new Set(messages.map(keyOf));
      // Tail first, so the indices ahead of each removal still hold.
      for (let index = list.length - 1; index >= 0; index--) {
        if (wanted.has(keyOf(list[index]!))) continue;
        setList(
          produce((current: FoldedMessage[]) => {
            current.splice(index, 1);
          })
        );
      }
      upsert(messages);
    });

  const applyEvents = (events: FoldedStreamEvent[]) =>
    batch(() => {
      for (const event of events) {
        if (event.kind === 'replace') replace(event.messages);
        else if (event.kind === 'metadata') setMetadata(event.metadata);
        else upsert([event.message]);
      }
    });

  // The shared session for the current id. A memo rather than an effect so
  // acquisition and release track the id exactly, with nothing to schedule.
  const live = createMemo(() => {
    const id = sessionId();
    if (!id) return undefined;
    const session = AgentSession.acquire(id);
    const unsubscribe = session.subscribe(applyEvents);
    onCleanup(() => {
      unsubscribe();
      session.release();
    });
    return session;
  });

  let latestRename: AgentSessionRenamedEvent | undefined;
  let renameRefresh = 0;

  const [resource, { mutate, refetch }] = createResource(
    live,
    async (session) => {
      const renameRefreshAtStart = renameRefresh;
      const superseded = () => untrack(sessionId) !== session.id;

      batch(() => {
        setList(reconcile([]));
        setBot(undefined);
        setMetadata(undefined);
      });

      const record = await session.load();
      if (superseded()) return record.session;
      // Read after every input pushed so far, and applied before any event
      // that arrives later: events between subscribe and here upserted into
      // the list, and this replaces the list with a view that includes them.
      const snapshot = await session.snapshot();
      if (superseded()) return record.session;

      batch(() => {
        setBot(record.bot);
        setMetadata(snapshot.metadata);
        replace(snapshot.messages);
      });

      return renameRefresh > renameRefreshAtStart &&
        latestRename?.agentSessionId === session.id
        ? { ...record.session, name: latestRename.name }
        : record.session;
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

  let updateRefresh = 0;
  onCleanup(
    subscribeAgentSessionUpdated((event) => {
      if (event.agentSessionId !== sessionId()) return;
      const run = ++updateRefresh;
      void (async () => {
        const session = await agentHarnessServiceClient.get(
          event.agentSessionId
        );
        if (
          session.isErr() ||
          run !== updateRefresh ||
          event.agentSessionId !== sessionId()
        ) {
          return;
        }
        mutate((current) => (current ? session.value : current));
      })();
    })
  );

  // A first fetch would suspend; see `openedPending`.
  const session = () =>
    openedPending && resource.state === 'pending' ? undefined : resource.latest;

  return {
    session,
    bot,
    metadata,
    messages: () => list,
    loadFailed: () => resource.error !== undefined,
    retry: () => void refetch(),
    issue: (action) => live()?.issue(action, { userId: options.userId() }),
    expect: (actionId, action) =>
      live()?.expect(actionId, action, { userId: options.userId() }),
    retract: (actionId) => live()?.retract(actionId),
    applySnapshot: (snapshot) => {
      if (sessionId() !== snapshot.id) return;
      mutate(snapshot);
    },
  };
}
