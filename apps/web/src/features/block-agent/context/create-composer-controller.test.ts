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
import {
  createComposerController,
  TURN_OBSERVE_TIMEOUT_MS,
} from './create-composer-controller';

const control = vi.hoisted(() => ({
  calls: [] as { sessionId: string; action: unknown }[],
  /** What the next `control` calls resolve to. */
  outcome: 'ok' as 'ok' | 'err' | 'reject',
  /** When true, each call waits until `release()` before resolving. */
  defer: false,
  waiters: [] as Array<(run: () => void) => void>,
  release() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const finish of waiters) finish();
  },
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    control: vi.fn(async (sessionId: string, action: unknown) => {
      control.calls.push({ sessionId, action });
      if (control.defer) {
        await new Promise<void>((resolve) => {
          control.waiters.push(resolve);
        });
      }
      if (control.outcome === 'reject') throw new Error('network');
      return { isErr: () => control.outcome === 'err' };
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

function setup(options?: { working?: boolean }) {
  const [working, setWorking] = createSignal(options?.working ?? false);
  const [sessionId, setSessionId] = createSignal('session-1');
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createComposerController({ sessionId, working }),
    dispose,
  }));
  return { controller, setWorking, setSessionId, dispose };
}

beforeEach(() => {
  control.calls = [];
  control.outcome = 'ok';
  control.defer = false;
  control.waiters = [];
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

  it('a second stop while one is in flight does not emit another stop', async () => {
    const { controller, dispose } = setup({ working: true });
    control.defer = true;
    controller.stop();
    controller.stop();
    controller.stop();
    expect(
      control.calls.filter(
        (c) => (c.action as { type: string }).type === 'stop'
      )
    ).toHaveLength(1);

    control.release();
    await flush();
    expect(
      control.calls.filter(
        (c) => (c.action as { type: string }).type === 'stop'
      )
    ).toHaveLength(1);
    dispose();
  });

  it('after stop, a queued prompt posts immediately even while the turn is still working', async () => {
    const { controller, dispose } = setup({ working: true });
    controller.send('queued');
    await flush();
    expect(prompts()).toEqual([]);

    controller.stop();
    await flush();

    expect(
      control.calls.map((c) => (c.action as { type: string }).type)
    ).toEqual(['stop', 'prompt']);
    expect(prompts()).toEqual(['queued']);
    dispose();
  });

  it('stop during an in-flight prompt POST does not resend that prompt', async () => {
    const { controller, dispose } = setup();
    control.defer = true;
    controller.send('hello');
    controller.send('next');
    await flush();
    expect(prompts()).toEqual(['hello']);

    controller.stop();
    controller.stop();
    expect(
      control.calls.map((c) => (c.action as { type: string }).type)
    ).toEqual(['prompt', 'stop']);

    control.defer = false;
    control.release();
    await flush();
    await flush();

    // The in-flight 'hello' is not resent; 'next' replaces the cancelled turn.
    expect(
      control.calls.map((c) => (c.action as { type: string }).type)
    ).toEqual(['prompt', 'stop', 'prompt']);
    expect(prompts()).toEqual(['hello', 'next']);
    expect(controller.queue()).toEqual([]);
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

describe('quote reply', () => {
  it('inserts into the attached input', () => {
    const { controller, dispose } = setup();
    const insertQuote = vi.fn();
    controller.attachInput({ insertQuote });
    controller.quoteReply('hello\nworld');
    expect(insertQuote).toHaveBeenCalledWith('hello\nworld');
    dispose();
  });

  it('is a no-op before an input is attached, and after it detaches', () => {
    const { controller, dispose } = setup();
    expect(() => controller.quoteReply('hello')).not.toThrow();
    const insertQuote = vi.fn();
    controller.attachInput({ insertQuote });
    controller.attachInput(undefined);
    controller.quoteReply('hello');
    expect(insertQuote).not.toHaveBeenCalled();
    dispose();
  });
});
