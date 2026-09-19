/**
 * The composer's send/stop/model controls.
 *
 * Prompt ordering lives in the service: every control POST joins the
 * session's per-command queue there, so a prompt sent mid-turn waits its
 * turn on the server, not in the client. `send` therefore posts
 * immediately, and the only state kept here is what the UI needs to show —
 * a prompt POST on the wire, a stop underway, a model change waiting to be
 * seen in the fold.
 */

import { toast } from '@core/component/Toast/Toast';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type Accessor, batch, createEffect } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ControlOutcome } from '../state/control-message';

export type ComposerController = {
  /** A prompt POST is on the wire. */
  sending: Accessor<boolean>;
  /** A turn is running or a prompt is on its way to start one — the stop
   *  affordance shows. */
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
  /** Post the prompt. No-op without a session — the input disables until
   *  there is one. */
  send: (markdown: string) => void;
  stop: () => void;
  /** Ask the agent to run on a different model from here on. */
  setModel: (model: string) => void;
};

export function createComposerController(options: {
  /** The fold's current model, which is how a model change is seen to land. */
  model?: Accessor<string | null | undefined>;
  /** Absent until a just-created session's `POST` lands
   *  (`context/pending-session.ts`). */
  sessionId: Accessor<string | undefined>;
  /** The block's one working signal — see `AgentSessionContext`. */
  working: Accessor<boolean>;
  /**
   * The fold's outcome for the control action `requestId` — the id the
   * control POST returned, which the fold stamps on the folded message the
   * action derives. A rejection is the other way a pending model change
   * resolves — the fold's `model` never moves for one — so without this a
   * refused switch would shimmer forever.
   */
  controlOutcome?: (requestId: string) => ControlOutcome | undefined;
}): ComposerController {
  const [state, setState] = createStore<{
    /** Prompt POSTs on the wire. A count, not a flag: sends can overlap. */
    inflightPrompts: number;
    /** The model a `setModel` is currently asking for. */
    requestedModel: string | undefined;
    /**
     * The id the control POST returned for the in-flight change — the exact
     * handle for its outcome in the fold, so no other action's rejection
     * (nor an older refusal of the same model) can answer this request.
     */
    requestedActionId: string | undefined;
    /**
     * A stop has been posted and the fold has not settled the turn yet.
     * Further clicks must not stack another `session/cancel`, each of which
     * the fold renders as its own accepted Stopped line.
     */
    stopping: boolean;
  }>({
    inflightPrompts: 0,
    requestedModel: undefined,
    requestedActionId: undefined,
    stopping: false,
  });

  const postPrompt = async (sessionId: string, markdown: string) => {
    setState('inflightPrompts', (count) => count + 1);
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'prompt', prompt: markdown })
      .catch(() => undefined);
    // Floored: a session switch resets the count while this POST is still
    // out, and its settle must not drive the new session's count negative.
    setState('inflightPrompts', (count) => Math.max(0, count - 1));
    if (result === undefined || result.isErr()) {
      toast.failure('Message could not be sent');
    }
    // A 200 with status `queued` means the prompt waits in the session's
    // server-side queue; the gateway publishes the queue, so nothing more
    // to do here.
  };

  const postSetModel = async (sessionId: string, model: string) => {
    setState('requestedModel', model);
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'setModel', model })
      .catch(() => undefined);
    if (result === undefined || result.isErr()) {
      batch(() => {
        setState('requestedModel', undefined);
        setState('requestedActionId', undefined);
      });
      toast.failure('The model could not be changed');
      return;
    }
    // The POST returning only means the service accepted it; resolution is
    // observed through the fold. The returned action id is the fold's
    // `requestId` for this change: an accepted change moves the metadata's
    // `model`, a rejected one resolves this id's control outcome, and the
    // effects below watch for whichever comes.
    if (state.requestedModel === model) {
      setState('requestedActionId', result.value.actionId);
    }
  };

  const postStop = async (sessionId: string) => {
    const result = await agentHarnessServiceClient
      .control(sessionId, { type: 'stop' })
      .catch(() => undefined);
    if (result === undefined || result.isErr()) {
      setState('stopping', false);
      toast.failure('The agent could not be stopped');
    }
    // Success is observed through the fold: the turn settles and `working`
    // flips false, which releases the latch.
  };

  const busy = () => options.working() || state.inflightPrompts > 0;

  // A model change is done when the fold says the runtime moved, not when
  // the POST returns. Also clears when the runtime settles somewhere else
  // entirely — another change overtook this one — so this can never stick.
  createEffect(() => {
    const requested = state.requestedModel;
    if (requested === undefined) return;
    const current = options.model?.();
    if (current == null) return;
    if (current === requested) {
      batch(() => {
        setState('requestedModel', undefined);
        setState('requestedActionId', undefined);
      });
    }
  });

  // The other resolution: the runtime refused the change. The fold resolves
  // this exact action's control outcome (`ControlOutcome::Rejected`) on the
  // message carrying its id, and the transcript renders the refusal; here it
  // just has to release the pending state, and say so — a refused switch
  // otherwise looks like one that never registered.
  createEffect(() => {
    const requested = state.requestedModel;
    const actionId = state.requestedActionId;
    if (requested === undefined || actionId === undefined) return;
    const outcome = options.controlOutcome?.(actionId);
    if (outcome?.kind !== 'rejected') return;
    batch(() => {
      setState('requestedModel', undefined);
      setState('requestedActionId', undefined);
    });
    toast.failure(`Couldn't switch to ${requested}`);
  });

  // The stop is done when the fold says the turn is no longer running. The
  // release is read off `working` rather than off the POST returning, because
  // the POST only means the cancel was accepted, not that the turn is over.
  createEffect(() => {
    if (!options.working()) setState('stopping', false);
  });

  // A session switch resets the composer: a pending model change or stop
  // belongs to the session it was issued in, never the next one.
  //
  // Acquiring an id is not a switch. A block that opened on a placeholder
  // goes `undefined -> id` when its create lands. The previous id is tracked
  // by hand rather than read from `on`'s `prevInput`, which a deferred `on`
  // leaves undefined through the first change and so cannot tell the two
  // apart.
  let previousSessionId = options.sessionId();
  createEffect(() => {
    const sessionId = options.sessionId();
    if (sessionId === previousSessionId) return;
    const acquired = previousSessionId === undefined;
    previousSessionId = sessionId;
    if (acquired) return;
    setState({
      // A send still on the wire belongs to the previous session; its
      // eventual settle must not keep this one's stop control up.
      inflightPrompts: 0,
      requestedModel: undefined,
      requestedActionId: undefined,
      stopping: false,
    });
  });

  return {
    sending: () => state.inflightPrompts > 0,
    busy,
    changingModel: () => state.requestedModel,
    send: (markdown) => {
      const sessionId = options.sessionId();
      if (!sessionId) return;
      void postPrompt(sessionId, markdown);
    },
    stop: () => {
      const sessionId = options.sessionId();
      if (!sessionId) return;
      if (!busy() || state.stopping) return;
      setState('stopping', true);
      void postStop(sessionId);
    },
    setModel: (model) => {
      const sessionId = options.sessionId();
      if (!sessionId) return;
      void postSetModel(sessionId, model);
    },
  };
}
