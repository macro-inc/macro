/**
 * @vitest-environment jsdom
 *
 * The controller against a mocked harness client: prompts post immediately
 * (the service owns queueing), failures surface as a toast, stop is latched
 * per turn, and a pending model change resolves only through the fold.
 */

import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlOutcome } from '../state/control-message';
import { createComposerController } from './create-composer-controller';

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
        // The control response — the action id is the fold's `requestId`
        // for the folded message this action derives. One per call, in
        // order; always `sent` here, queueing is the server's business.
        value: {
          actionId: `action-${control.calls.length - 1}`,
          status: 'sent',
        },
      };
    }),
  },
}));

const toast = vi.hoisted(() => ({ failure: vi.fn(), success: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

/** Let the awaited POST settle. */
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
  toast.failure.mockClear();
});

describe('sending', () => {
  it('posts immediately', async () => {
    const { controller, dispose } = setup();
    controller.send('hello');
    await flush();

    expect(prompts()).toEqual(['hello']);
    expect(controller.sending()).toBe(false);
    dispose();
  });

  it('posts immediately even while a turn is running — the service queues', async () => {
    const { controller, dispose } = setup({ working: true });
    controller.send('one');
    controller.send('two');
    await flush();

    expect(prompts()).toEqual(['one', 'two']);
    dispose();
  });

  it('reports sending while the POST is on the wire', async () => {
    const { controller, dispose } = setup();
    controller.send('hello');

    expect(controller.sending()).toBe(true);
    expect(controller.busy()).toBe(true);
    await flush();
    expect(controller.sending()).toBe(false);
    expect(controller.busy()).toBe(false);
    dispose();
  });

  it('surfaces a failed POST as a toast', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'err';
    controller.send('doomed');
    await flush();

    expect(toast.failure).toHaveBeenCalledWith('Message could not be sent');
    expect(controller.sending()).toBe(false);
    dispose();
  });

  it('a rejected promise (network error) behaves like a failure', async () => {
    const { controller, dispose } = setup();
    control.outcome = 'reject';
    controller.send('offline');
    await flush();

    expect(toast.failure).toHaveBeenCalledWith('Message could not be sent');
    expect(controller.sending()).toBe(false);
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
  it('does not post anything before there is a session', async () => {
    const { controller, dispose } = setup({ sessionId: undefined });
    controller.send('too early');
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
  it('drops a pending model change — it never leaks into another session', async () => {
    const { controller, setSessionId, dispose } = setup({ model: 'old-model' });
    controller.setModel('new-model');
    await flush();
    expect(controller.changingModel()).toBe('new-model');

    setSessionId('session-2');
    await flush();

    expect(controller.changingModel()).toBeUndefined();
    dispose();
  });
});
