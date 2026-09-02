/**
 * @vitest-environment jsdom
 *
 * The controller end to end against a mocked harness client: the drain
 * sends, failures latch and retry, prompts queue behind a running turn and
 * flush when it settles, and `awaiting_turn` cannot wedge — it frees on the
 * fold's signal or on the timeout, whichever comes first.
 */

import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlOutcome } from '../state/control-message';
import {
  createComposerController,
  TURN_OBSERVE_TIMEOUT_MS,
} from './create-composer-controller';

const control = vi.hoisted(() => ({
  calls: [] as { sessionId: string; action: unknown }[],
  /** What the next `control` calls resolve to. */
  outcome: 'ok' as 'ok' | 'err' | 'reject',
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    control: vi.fn(async (sessionId: string, action: unknown) => {
      control.calls.push({ sessionId, action });
      if (control.outcome === 'reject') throw new Error('network');
      return {
        isErr: () => control.outcome === 'err',
        // The action id the endpoint returns — the fold's `requestId` for
        // the folded message this action derives. One per call, in order.
        value: `action-${control.calls.length - 1}`,
      };
    }),
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

/** Let the drain effect and the awaited POST settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const prompts = () =>
  control.calls
    .filter((c) => (c.action as { type: string }).type === 'prompt')
    .map((c) => (c.action as { prompt: string }).prompt);

function setup(options?: {
  working?: boolean;
  sessionId?: string;
  model?: string | null;
}) {
  const [working, setWorking] = createSignal(options?.working ?? false);
  const [sessionId, setSessionId] = createSignal<string | undefined>(
    'sessionId' in (options ?? {}) ? options?.sessionId : 'session-1'
  );
  const [model, setModel] = createSignal<string | null>(options?.model ?? null);
  // The fold's per-action outcomes, keyed by the id `control` returned.
  const [outcomes, setOutcomes] = createSignal<Record<string, ControlOutcome>>(
    {}
  );
  const resolveControl = (requestId: string, outcome: ControlOutcome) =>
    setOutcomes((current) => ({ ...current, [requestId]: outcome }));
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createComposerController({
      sessionId,
      working,
      model,
      controlOutcome: (requestId) => outcomes()[requestId],
    }),
    dispose,
  }));
  return {
    controller,
    setWorking,
    setSessionId,
    setModel,
    resolveControl,
    dispose,
  };
}

beforeEach(() => {
  control.calls = [];
  control.outcome = 'ok';
  vi.useRealTimers();
});

describe('sending while idle', () => {
  it('posts immediately and empties the queue', async () => {
    const { controller, dispose } = setup();
    controller.send('hello');
    await flush();

    expect(prompts()).toEqual(['hello']);
    expect(controller.queue()).toEqual([]);
    dispose();
  });
});

describe('failure', () => {
  it('keeps the failed prompt visible at the head and latches the drain', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'err';
    controller.send('doomed');
    await flush();

    expect(controller.queue().map((p) => p.markdown)).toEqual(['doomed']);
    expect(controller.sendFailed()).toBe(true);
    // The latch holds: no second attempt without user action.
    expect(prompts()).toEqual(['doomed']);
    dispose();
  });

  it('retry() releases the latch and posts the same prompt again', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'err';
    controller.send('doomed');
    await flush();

    control.outcome = 'ok';
    controller.retry();
    await flush();

    expect(prompts()).toEqual(['doomed', 'doomed']);
    expect(controller.queue()).toEqual([]);
    expect(controller.sendFailed()).toBe(false);
    dispose();
  });

  it('a new send also releases the latch, and order is preserved', async () => {
    const { controller, setWorking, dispose } = setup();
    control.outcome = 'err';
    controller.send('first');
    await flush();

    control.outcome = 'ok';
    controller.send('second');
    await flush();
    // The retried 'first' is awaiting its turn; 'second' correctly holds.
    expect(prompts()).toEqual(['first', 'first']);

    setWorking(true); // the fold shows first's turn
    await flush();
    setWorking(false); // ...and it settles
    await flush();

    expect(prompts()).toEqual(['first', 'first', 'second']);
    dispose();
  });

  it('removing the failed prompt clears the failure and unblocks the rest', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'err';
    controller.send('bad');
    await flush();
    control.outcome = 'ok';
    controller.send('good');
    // 'good' releases the latch; make 'bad' fail once more so it latches
    // again with 'good' waiting behind it.
    control.outcome = 'err';
    await flush();

    control.outcome = 'ok';
    const failedId = controller.queue()[0]!.id;
    controller.remove(failedId);
    await flush();

    expect(prompts().at(-1)).toBe('good');
    expect(controller.queue()).toEqual([]);
    dispose();
  });

  it('a rejected promise (network error) behaves like a failure', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'reject';
    controller.send('offline');
    await flush();

    expect(controller.sendFailed()).toBe(true);
    expect(controller.queue().map((p) => p.markdown)).toEqual(['offline']);
    dispose();
  });
});

describe('queueing behind a running turn', () => {
  it('holds while working and sends when the turn settles', async () => {
    const { controller, setWorking, dispose } = setup({ working: true });
    controller.send('queued');
    await flush();

    expect(prompts()).toEqual([]);
    expect(controller.queue().map((p) => p.markdown)).toEqual(['queued']);

    setWorking(false);
    await flush();

    expect(prompts()).toEqual(['queued']);
    expect(controller.queue()).toEqual([]);
    dispose();
  });

  it('sends queued prompts one at a time, in order, across turns', async () => {
    const { controller, setWorking, dispose } = setup({ working: true });
    controller.send('one');
    controller.send('two');
    await flush();

    setWorking(false);
    await flush();
    // 'one' posted; the slot is awaiting_turn, so 'two' holds.
    expect(prompts()).toEqual(['one']);

    setWorking(true); // the fold shows one's turn
    await flush();
    setWorking(false); // ...and it settles
    await flush();

    expect(prompts()).toEqual(['one', 'two']);
    dispose();
  });
});

describe('awaiting_turn cannot wedge', () => {
  it('frees when the fold reports the turn', async () => {
    const { controller, setWorking, dispose } = setup();
    controller.send('hello');
    await flush();
    expect(controller.busy()).toBe(true); // awaiting_turn

    setWorking(true);
    await flush();
    expect(controller.busy()).toBe(true); // now because working
    setWorking(false);
    await flush();
    expect(controller.busy()).toBe(false); // fully idle — no wedge
    dispose();
  });

  it('frees on the timeout when no turn ever appears', async () => {
    vi.useFakeTimers();
    const { controller, dispose } = setup();
    controller.send('hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.busy()).toBe(true);

    await vi.advanceTimersByTimeAsync(TURN_OBSERVE_TIMEOUT_MS);
    expect(controller.busy()).toBe(false);
    dispose();
  });
});

describe('stop', () => {
  it('posts a stop while busy and is a no-op while idle', async () => {
    const { controller, setWorking, dispose } = setup();
    controller.stop();
    await flush();
    expect(control.calls).toEqual([]);

    setWorking(true);
    controller.stop();
    await flush();
    expect(control.calls.at(-1)?.action).toEqual({ type: 'stop' });
    dispose();
  });

  // Each cancel the service accepts is its own Stopped line in the
  // transcript, so a user clicking through a turn that takes a moment to
  // settle would otherwise stack one per click.
  it('posts one stop per turn, however many times it is clicked', async () => {
    const { controller, setWorking, dispose } = setup({ working: true });
    const isStop = (action: unknown) =>
      typeof action === 'object' &&
      action !== null &&
      'type' in action &&
      action.type === 'stop';
    const stops = () => control.calls.filter((call) => isStop(call.action));

    controller.stop();
    controller.stop();
    controller.stop();
    await flush();
    expect(stops()).toHaveLength(1);

    // The next turn stops on its own click: the latch tracks the turn, not
    // the session.
    setWorking(false);
    await flush();
    setWorking(true);
    controller.stop();
    await flush();
    expect(stops()).toHaveLength(2);
    dispose();
  });
});

describe('a session that does not exist yet', () => {
  it('queues prompts typed before the create lands, then drains them in order', async () => {
    const { controller, setWorking, setSessionId, dispose } = setup({
      sessionId: undefined,
    });
    controller.send('first');
    controller.send('second');
    await flush();

    // Nothing on the wire: there is nowhere to post to.
    expect(prompts()).toEqual([]);
    expect(controller.queue().map((p) => p.markdown)).toEqual([
      'first',
      'second',
    ]);

    setSessionId('session-1');
    await flush();
    // The queue survived acquiring the id, and its head went out against it.
    expect(prompts()).toEqual(['first']);
    expect(control.calls.every((c) => c.sessionId === 'session-1')).toBe(true);

    setWorking(true); // the fold shows first's turn
    await flush();
    setWorking(false); // ...and it settles
    await flush();

    expect(prompts()).toEqual(['first', 'second']);
    expect(controller.queue()).toEqual([]);
    dispose();
  });

  it('does not post stop or setModel before there is a session', async () => {
    const { controller, dispose } = setup({ sessionId: undefined });
    controller.stop();
    controller.setModel('opus');
    await flush();

    expect(control.calls).toEqual([]);
    dispose();
  });
});

describe('a model change in flight', () => {
  it('holds until the fold shows the runtime moved, not until the POST returns', async () => {
    const { controller, setModel, dispose } = setup({ model: 'old-model' });
    controller.setModel('new-model');
    await flush();

    // The POST has already come back; the runtime has not moved yet.
    expect(control.calls.at(-1)?.action).toEqual({
      type: 'setModel',
      model: 'new-model',
    });
    expect(controller.changingModel()).toBe('new-model');

    setModel('new-model');
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });

  it('clears when the runtime settles on something else entirely', async () => {
    const { controller, setModel, dispose } = setup({ model: 'old-model' });
    controller.setModel('new-model');
    await flush();

    // A later change overtook this one; nothing is still pending.
    setModel('third-model');
    await flush();
    controller.setModel('third-model');
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });

  it('clears immediately when the POST fails', async () => {
    const { controller, dispose } = setup({ model: 'old-model' });
    control.outcome = 'err';
    controller.setModel('new-model');
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });

  it('clears when the runtime rejects the change', async () => {
    const { controller, resolveControl, dispose } = setup({
      model: 'old-model',
    });
    controller.setModel('new-model');
    await flush();
    expect(controller.changingModel()).toBe('new-model');

    // The runtime refuses: the fold resolves this action's control outcome,
    // the model never moves. The pending state must release on it alone.
    resolveControl('action-0', {
      kind: 'rejected',
      message: 'no provider serves it',
    });
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });

  it("ignores another action's rejection", async () => {
    const { controller, resolveControl, dispose } = setup({
      model: 'old-model',
    });
    // An earlier change was refused before this request.
    controller.setModel('new-model');
    await flush();
    controller.setModel('new-model');
    await flush();

    // The first action's rejection must not answer the second request…
    resolveControl('action-0', { kind: 'rejected', message: 'refused' });
    await flush();
    expect(controller.changingModel()).toBe('new-model');

    // …but its own does.
    resolveControl('action-1', { kind: 'rejected', message: 'refused again' });
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });

  it('keeps waiting while its own action is pending or accepted', async () => {
    const { controller, resolveControl, dispose } = setup({
      model: 'old-model',
    });
    controller.setModel('new-model');
    await flush();

    resolveControl('action-0', { kind: 'pending' });
    await flush();
    expect(controller.changingModel()).toBe('new-model');

    // Accepted alone is not the end of the wait — the fold's `model` moving
    // is (the accepted response carries it) — so the pending state holds.
    resolveControl('action-0', { kind: 'accepted' });
    await flush();
    expect(controller.changingModel()).toBe('new-model');
    dispose();
  });
});

describe('session switch', () => {
  it('drops the queue — prompts never leak into another session', async () => {
    const { controller, setSessionId, dispose } = setup({ working: true });
    controller.send('for session-1');
    await flush();

    setSessionId('session-2');
    await flush();

    expect(controller.queue()).toEqual([]);
    expect(prompts()).toEqual([]);
    dispose();
  });
});
