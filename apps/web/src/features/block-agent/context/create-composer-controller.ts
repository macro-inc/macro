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
 */

import { toast } from '@core/component/Toast/Toast';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type Accessor, batch, createEffect, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  isBusy,
  nextAction,
  type PostPhase,
  type QueuedPrompt,
} from '../state/composer-state';

export type ComposerController = {
  /** Prompts waiting to be sent, oldest first. The head sends next. */
  queue: Accessor<QueuedPrompt[]>;
  /** The prompt currently on the wire or awaiting its turn, if any. */
  sendingId: Accessor<string | undefined>;
  /** The head prompt failed to post and is held for retry. */
  sendFailed: Accessor<boolean>;
  /** A turn is running or a post is starting one — the stop affordance shows. */
  busy: Accessor<boolean>;
  /**
   * A model change is on the wire: the id requested, until the fold shows the
   * runtime moved to it (or the POST fails).
   *
   * Worth its own signal because this is the request that can take longest
   * with the least to show for it — a change issued to a reaped sandbox
   * blocks in the service for the whole container resume, and nothing is
   * written to the log until it lands, so without this the UI has no
   * evidence anything is happening at all.
   */
  changingModel: Accessor<string | undefined>;
  send: (markdown: string) => void;
  /** Release a failed head so the drain tries it again. */
  retry: () => void;
  /** Drop a queued prompt. Dropping the failed head clears the failure. */
  remove: (promptId: string) => void;
  stop: () => void;
  /** Ask the agent to run on a different model from here on. */
  setModel: (model: string) => void;
};

/**
 * How long `awaiting_turn` waits for the fold to show the posted turn before
 * giving up and freeing the post slot. Normally the prompt frame echoes back
 * within milliseconds of the POST ack; this only fires when the runtime or
 * the socket has genuinely gone quiet.
 */
export const TURN_OBSERVE_TIMEOUT_MS = 10_000;

export function createComposerController(options: {
  /** The fold's current model, which is how a model change is seen to land. */
  model?: Accessor<string | null | undefined>;
  /**
   * Absent until a just-created session's `POST` lands
   * (`context/pending-session.ts`). Prompts typed before then queue and
   * drain themselves when it arrives — that is the whole point of `send`
   * only enqueueing.
   */
  sessionId: Accessor<string | undefined>;
  /** The block's one working signal — see `AgentSessionContext`. */
  working: Accessor<boolean>;
}): ComposerController {
  const [state, setState] = createStore<{
    queue: QueuedPrompt[];
    post: PostPhase;
    /** The model a `setModel` is currently asking for. */
    requestedModel: string | undefined;
  }>({
    queue: [],
    post: { type: 'idle' },
    requestedModel: undefined,
  });

  const postHead = async (sessionId: string, prompt: QueuedPrompt) => {
    setState('post', { type: 'posting', promptId: prompt.id });
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'prompt', prompt: prompt.markdown })
      .catch(() => undefined);

    if (result === undefined || result.isErr()) {
      // The prompt stays at the head of the queue — visible and retryable,
      // never dropped. The latch stops the drain until the user acts.
      setState('post', { type: 'failed', promptId: prompt.id });
      toast.failure('Message could not be sent');
      return;
    }
    batch(() => {
      setState('queue', (queue) => queue.filter((p) => p.id !== prompt.id));
      setState('post', { type: 'awaiting_turn', promptId: prompt.id });
    });
  };

  const postSetModel = async (sessionId: string, model: string) => {
    setState('requestedModel', model);
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'setModel', model })
      .catch(() => undefined);
    if (result === undefined || result.isErr()) {
      setState('requestedModel', undefined);
      toast.failure('The model could not be changed');
    }
    // Success is observed through the fold: the runtime acks the config
    // change and the session metadata's `model` moves. The POST returning is
    // not the end of the wait — it only means the service accepted it — so
    // `requestedModel` is cleared by the effect below, not here.
  };

  const postStop = async (sessionId: string) => {
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'stop' })
      .catch(() => undefined);
    if (result === undefined || result.isErr()) {
      toast.failure('The agent could not be stopped');
    }
    // Success is observed through the fold: the turn settles and `working`
    // flips false, which re-runs the drain.
  };

  // The drain: whenever any fact changes, ask the model what to do and do
  // it. Deciding from present facts — rather than reacting to event edges —
  // is what makes this wedge-proof: there is no exit event to miss.
  createEffect(() => {
    const sessionId = options.sessionId();
    const action = nextAction({
      post: state.post,
      head: state.queue[0],
      agentWorking: options.working(),
      sessionExists: sessionId !== undefined,
    });
    // `sessionExists` is what makes the id below sound: the drain cannot
    // choose to post without one.
    if (action.type === 'post_head' && sessionId) {
      void postHead(sessionId, action.prompt);
    }
  });

  // A model change is done when the fold says the runtime moved, not when
  // the POST returns. Also clears when the runtime settles somewhere else
  // entirely — another change overtook this one — so this can never stick.
  createEffect(() => {
    const requested = state.requestedModel;
    if (requested === undefined) return;
    const current = options.model?.();
    if (current == null) return;
    if (current === requested) setState('requestedModel', undefined);
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

  // A session switch resets the composer: queued prompts belong to the
  // session they were typed in, never the next one.
  //
  // Acquiring an id is not a switch. A block that opened on a placeholder
  // goes `undefined -> id` when its create lands, and everything typed
  // during the wait was typed for exactly that session — wiping it there is
  // the one thing that would make typing early pointless. The previous id is
  // tracked by hand rather than read from `on`'s `prevInput`, which a
  // deferred `on` leaves undefined through the first change and so cannot
  // tell the two apart.
  let previousSessionId = options.sessionId();
  createEffect(() => {
    const sessionId = options.sessionId();
    if (sessionId === previousSessionId) return;
    const acquired = previousSessionId === undefined;
    previousSessionId = sessionId;
    if (acquired) return;
    setState({
      queue: [],
      post: { type: 'idle' },
      requestedModel: undefined,
    });
  });

  return {
    queue: () => state.queue,
    sendingId: () =>
      state.post.type === 'posting' || state.post.type === 'awaiting_turn'
        ? state.post.promptId
        : undefined,
    sendFailed: () => state.post.type === 'failed',
    busy: () => isBusy(state.post, options.working()),
    changingModel: () => state.requestedModel,
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
      const sessionId = options.sessionId();
      if (!sessionId) return;
      if (!isBusy(state.post, options.working())) return;
      void postStop(sessionId);
    },
    setModel: (model) => {
      const sessionId = options.sessionId();
      if (!sessionId) return;
      void postSetModel(sessionId, model);
    },
  };
}
