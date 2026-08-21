/**
 * The Solid shell around the composer model (`state/composer-state.ts`).
 *
 * One store holds the two facts the controller owns — the prompt queue and
 * the single in-flight POST's phase. The heart is one effect, the drain: on
 * any change it asks `nextAction` what to do and does it. There are no
 * transition events and no phase that waits for a specific event to exit.
 * The one bridge state, `awaiting_turn` (POST accepted, turn not yet visible
 * in the fold), is bounded by a timeout so a turn that never appears cannot
 * wedge the composer.
 *
 * `send` only enqueues. Whether the prompt goes out now or waits for the
 * running turn to settle is entirely the drain's call — the same code path
 * either way, so queueing is not a special case.
 *
 * `stop` is one in-flight cancel: a second click is a no-op. After the
 * cancel is accepted, a queued prompt posts immediately (Claude Code's
 * stop-then-send) instead of waiting for the fold to drop `working`.
 */

import { toast } from '@core/component/Toast/Toast';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type Accessor, batch, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  canStop,
  isBusy,
  nextAction,
  type PostPhase,
  type QueuedPrompt,
} from '../state/composer-state';

/** Late-bound composer surface so transcript replies can insert a quote. */
export type ComposerInputHandle = {
  insertQuote: (quotedContent: string) => void;
  focus?: () => void;
};

export type ComposerController = {
  /** Prompts waiting to be sent, oldest first. The head sends next. */
  queue: Accessor<QueuedPrompt[]>;
  /** The prompt currently on the wire or awaiting its turn, if any. */
  sendingId: Accessor<string | undefined>;
  /** The head prompt failed to post and is held for retry. */
  sendFailed: Accessor<boolean>;
  /** A turn is running or a post is starting one — the stop affordance shows. */
  busy: Accessor<boolean>;
  send: (markdown: string) => void;
  /** Release a failed head so the drain tries it again. */
  retry: () => void;
  /** Drop a queued prompt. Dropping the failed head clears the failure. */
  remove: (promptId: string) => void;
  stop: () => void;
  /** Wire the mounted input so quote-replies can reach it. */
  attachInput: (handle: ComposerInputHandle | undefined) => void;
  /** Insert a channel-style quote of `quotedContent` into the draft. */
  quoteReply: (quotedContent: string) => void;
};

/**
 * How long `awaiting_turn` waits for the fold to show the posted turn before
 * giving up and freeing the post slot. Normally the prompt frame echoes back
 * within milliseconds of the POST ack; this only fires when the runtime or
 * the socket has genuinely gone quiet.
 */
export const TURN_OBSERVE_TIMEOUT_MS = 10_000;

export function createComposerController(options: {
  sessionId: Accessor<string>;
  /** The block's one working signal — see `AgentSessionContext`. */
  working: Accessor<boolean>;
}): ComposerController {
  const [state, setState] = createStore<{
    queue: QueuedPrompt[];
    post: PostPhase;
    replacing: boolean;
  }>({
    queue: [],
    post: { type: 'idle' },
    replacing: false,
  });

  // Late-bound: the input publishes this on mount. Quote-replies fire from
  // click handlers, so a plain binding is enough — nothing renders from it.
  let input: ComposerInputHandle | undefined;
  // Bumped when a stop starts so an in-flight prompt POST cannot overwrite
  // the stopping phase (or re-queue itself) when it later resolves.
  let epoch = 0;

  const postHead = async (prompt: QueuedPrompt) => {
    const gen = epoch;
    batch(() => {
      setState('post', { type: 'posting', promptId: prompt.id });
      setState('replacing', false);
    });
    const result = await agentHarnessServiceClient
      .control(options.sessionId(), { type: 'prompt', prompt: prompt.markdown })
      .catch(() => undefined);

    if (result === undefined || result.isErr()) {
      if (gen !== epoch) return;
      // The prompt stays at the head of the queue — visible and retryable,
      // never dropped. The latch stops the drain until the user acts.
      setState('post', { type: 'failed', promptId: prompt.id });
      toast.failure('Message could not be sent');
      return;
    }
    // The server accepted it: drop from the queue even if a stop superseded
    // this completion, so we never re-send a prompt we just cancelled.
    setState('queue', (queue) => queue.filter((p) => p.id !== prompt.id));
    if (gen !== epoch) return;
    setState('post', { type: 'awaiting_turn', promptId: prompt.id });
  };

  const postStop = async () => {
    const postingId =
      state.post.type === 'posting' ? state.post.promptId : undefined;
    epoch += 1;
    const gen = epoch;
    batch(() => {
      setState('post', { type: 'stopping' });
      setState('replacing', false);
    });
    const result = await agentHarnessServiceClient
      .control(options.sessionId(), { type: 'stop' })
      .catch(() => undefined);
    if (gen !== epoch) return;
    if (result === undefined || result.isErr()) {
      setState('post', { type: 'idle' });
      toast.failure('The agent could not be stopped');
      return;
    }
    // Success: free the post slot and, if anything is queued, let it replace
    // this turn immediately. Drop a prompt whose POST was still in flight so
    // stop cannot resend the very message it cancelled. The fold dropping
    // `working` is observed, not awaited.
    const remaining = postingId
      ? state.queue.filter((p) => p.id !== postingId)
      : state.queue;
    batch(() => {
      if (postingId) {
        setState('queue', remaining);
      }
      setState('post', { type: 'idle' });
      setState('replacing', remaining.length > 0);
    });
  };

  // The drain: whenever any fact changes, ask the model what to do and do
  // it. Deciding from present facts — rather than reacting to event edges —
  // is what makes this wedge-proof: there is no exit event to miss.
  createEffect(() => {
    const action = nextAction({
      post: state.post,
      head: state.queue[0],
      agentWorking: options.working(),
      replacing: state.replacing,
    });
    if (action.type === 'post_head') void postHead(action.prompt);
  });

  // `awaiting_turn` resolves on whichever comes first: the fold reports the
  // turn (`working` flips true), or the timeout gives up. Either way the
  // post slot frees and the drain re-decides from there.
  createEffect(() => {
    if (state.post.type !== 'awaiting_turn') return;
    if (options.working()) {
      setState('post', { type: 'idle' });
      return;
    }
    const timer = setTimeout(
      () => setState('post', { type: 'idle' }),
      TURN_OBSERVE_TIMEOUT_MS
    );
    onCleanup(() => clearTimeout(timer));
  });

  // The cancelled turn settled: `replacing` has done its job (either the
  // queued prompt already posted, or there was nothing to send).
  createEffect(() => {
    if (!state.replacing) return;
    if (!options.working()) setState('replacing', false);
  });

  // A session switch resets the composer: queued prompts belong to the
  // session they were typed in, never the next one.
  createEffect(
    on(
      options.sessionId,
      () => {
        epoch += 1;
        setState({ queue: [], post: { type: 'idle' }, replacing: false });
      },
      { defer: true }
    )
  );

  return {
    queue: () => state.queue,
    sendingId: () =>
      state.post.type === 'posting' || state.post.type === 'awaiting_turn'
        ? state.post.promptId
        : undefined,
    sendFailed: () => state.post.type === 'failed',
    busy: () => isBusy(state.post, options.working()),
    send: (markdown) => {
      batch(() => {
        setState('queue', (queue) => [
          ...queue,
          { id: crypto.randomUUID(), markdown },
        ]);
        // A new message is intent to continue: release a failed head so the
        // drain retries it (in order) rather than holding everything behind
        // a stale failure.
        if (state.post.type === 'failed') setState('post', { type: 'idle' });
      });
    },
    retry: () => {
      if (state.post.type === 'failed') setState('post', { type: 'idle' });
    },
    remove: (promptId) => {
      batch(() => {
        setState('queue', (queue) => queue.filter((p) => p.id !== promptId));
        if (state.post.type === 'failed' && state.post.promptId === promptId) {
          setState('post', { type: 'idle' });
        }
      });
    },
    stop: () => {
      if (!canStop(state.post, options.working())) return;
      void postStop();
    },
    attachInput: (handle) => {
      input = handle;
    },
    quoteReply: (quotedContent) => {
      input?.insertQuote(quotedContent);
    },
  };
}
