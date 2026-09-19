/**
 * The composer's view of the session's server-side action queue.
 *
 * The queue is the server's: prompts and compacts sent while a turn runs
 * wait there and dispatch one per turn end. Nothing is queued or predicted
 * client-side, and nothing polls. The gateway publishes the whole queue on
 * every mutation (`agent_session_queue`), so the controller reads the REST
 * endpoint exactly once per socket session as a baseline — on load and again
 * on websocket reconnect — and after the first event arrives on the current
 * socket the socket is the only writer: any GET still in flight is
 * discarded, no further GETs are issued (own mutations included — the server
 * publishes for those too), and the last event wins unconditionally.
 */

import { toast } from '@core/component/Toast/Toast';
import {
  subscribeAgentSessionQueue,
  subscribeSocketSessionStarted,
} from '@queries/agent-session/queue-sync';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { QueuedActionDto } from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

export type QueueController = {
  /**
   * The actions still waiting, oldest first, minus any the fold already
   * shows. An entry whose `actionId` matches a folded message's `requestId`
   * has dispatched — the transcript renders it, so the queue must not.
   */
  entries: Accessor<QueuedActionDto[]>;
  /** Replace a queued prompt's text. A 404 means it already dispatched —
   *  the gateway's snapshot reconciles it, not an error. */
  edit: (actionId: string, prompt: string) => Promise<void>;
  /** Remove a queued action. Same 404 semantics as `edit`. */
  remove: (actionId: string) => Promise<void>;
};

export function createQueueController(options: {
  /** Absent until a just-created session's `POST` lands. */
  sessionId: Accessor<string | undefined>;
  /** The folded transcript: the dedupe source for dispatched entries. */
  messages: Accessor<FoldedMessage[]>;
}): QueueController {
  const [queued, setQueued] = createSignal<QueuedActionDto[]>([]);

  // Whether an `agent_session_queue` event has arrived for this session on
  // the current socket session. Once true the socket is the only writer:
  // baseline responses are discarded and no further GETs go out. Reset when
  // the socket reopens (events may have been missed) or the session changes.
  //
  // The one latch is the whole reconciliation. An event is always the full
  // queue, so events need no ordering among themselves, and a baseline
  // response identifies itself by the session it was fetched for.
  let socketAuthoritative = false;

  const baseline = async () => {
    const sessionId = untrack(options.sessionId);
    if (!sessionId) return;
    const result = await agentHarnessServiceClient
      .queue(sessionId)
      .catch(() => undefined);
    // Discarded when an event beat it here, or when it answers for a session
    // this block no longer shows. A failed baseline keeps the last known
    // entries; the next socket event or reconnect supersedes it anyway.
    if (socketAuthoritative || sessionId !== untrack(options.sessionId)) return;
    if (result === undefined || result.isErr()) return;
    setQueued(result.value.entries);
  };

  // A session switch drops the old session's entries immediately — they were
  // never this session's — then baselines the new one.
  createEffect(
    on(options.sessionId, () => {
      socketAuthoritative = false;
      setQueued([]);
      void baseline();
    })
  );

  // The gateway always wins: every event is the full queue, last one in is
  // the truth, and hearing anything on this socket retires the baseline GET.
  onCleanup(
    subscribeAgentSessionQueue((event) => {
      if (event.agentSessionId !== untrack(options.sessionId)) return;
      socketAuthoritative = true;
      setQueued(event.entries);
    })
  );

  // A reopened socket is a new socket session: events may have been missed
  // while it was down, so re-baseline once and let events take over again.
  onCleanup(
    subscribeSocketSessionStarted(() => {
      socketAuthoritative = false;
      baseline();
    })
  );

  const dispatchedIds = createMemo(() => {
    const ids = new Set<string>();
    for (const message of options.messages()) {
      if (message.requestId != null) ids.add(message.requestId);
    }
    return ids;
  });

  const isDispatched = (
    result: Awaited<ReturnType<typeof agentHarnessServiceClient.removeQueued>>
  ) =>
    result.isErr() && result.error.some((error) => error.code === 'NOT_FOUND');

  // No refetch after either mutation: the server publishes a snapshot for
  // every accepted change, and a 404 means the entry dispatched — the
  // dispatch's own snapshot (and the fold dedupe) already retire the row.
  const edit = async (actionId: string, prompt: string) => {
    const sessionId = untrack(options.sessionId);
    if (!sessionId) return;
    const result = await agentHarnessServiceClient
      .editQueued(sessionId, actionId, prompt)
      .catch(() => undefined);
    if (result === undefined || (result.isErr() && !isDispatched(result))) {
      toast.failure('The queued message could not be edited');
    }
  };

  const remove = async (actionId: string) => {
    const sessionId = untrack(options.sessionId);
    if (!sessionId) return;
    const result = await agentHarnessServiceClient
      .removeQueued(sessionId, actionId)
      .catch(() => undefined);
    if (result === undefined || (result.isErr() && !isDispatched(result))) {
      toast.failure('The queued message could not be removed');
    }
  };

  return {
    entries: () =>
      queued().filter((entry) => !dispatchedIds().has(entry.actionId)),
    edit,
    remove,
  };
}
