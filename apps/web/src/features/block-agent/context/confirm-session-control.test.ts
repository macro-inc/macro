import type { AgentSession } from '@core/agent-session/AgentSession';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spanAttributes = vi.hoisted(() => new Map<string, unknown>());
// A span takes attributes until its callback settles, as an ended one would.
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: async (_name: string, run: (span: unknown) => Promise<void>) => {
      let ended = false;
      try {
        return await run({
          setAttr: (name: string, value: unknown) => {
            if (!ended) spanAttributes.set(name, value);
          },
          error: () => undefined,
        });
      } finally {
        ended = true;
      }
    },
  },
}));

import { confirmSessionControl } from './confirm-session-control';

function session() {
  let listener = () => {};
  const unsubscribe = vi.fn();
  const snapshot = { messages: [] as unknown[] };
  const value = {
    issue: vi
      .fn()
      .mockResolvedValue(ok({ actionId: 'action', status: 'sent' })),
    snapshot: vi.fn(async () => snapshot),
    subscribe: vi.fn((callback: () => void) => {
      listener = callback;
      return unsubscribe;
    }),
    refresh: vi.fn(async () => {}),
    retract: vi.fn(),
  };
  return {
    value: value as unknown as AgentSession,
    issue: value.issue,
    refresh: value.refresh,
    retract: value.retract,
    unsubscribe,
    /** Settle the control in the snapshot without a fold event. */
    settleQuietly(kind: string) {
      snapshot.messages = [
        {
          requestId: 'action',
          pending: false,
          parts: [{ kind: 'control', outcome: { kind } }],
        },
      ];
    },
    outcome(kind: string, requestId = 'action') {
      snapshot.messages = [
        {
          requestId,
          pending: false,
          parts: [
            {
              kind: 'control',
              outcome: { kind, message: 'unsupported effort' },
            },
          ],
        },
      ];
      listener();
    },
  };
}
const action = {
  type: 'setConfigOption',
  configId: 'effort',
  value: 'ultra',
} as const;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  vi.useRealTimers();
  spanAttributes.clear();
});
describe('confirmed session controls', () => {
  it('waits past HTTP acceptance and unrelated actions for the correlated runtime outcome', async () => {
    const test = session();
    const done = vi.fn();
    const result = confirmSessionControl(test.value, action).then(done);
    await flush();
    expect(done).not.toHaveBeenCalled();
    test.outcome('accepted', 'another-action');
    await flush();
    expect(done).not.toHaveBeenCalled();
    test.outcome('accepted');
    await result;
    expect(done).toHaveBeenCalledOnce();
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });
  it('rejects when ACP rejects a queued setting', async () => {
    const test = session();
    const result = confirmSessionControl(test.value, action);
    const assertion = expect(result).rejects.toThrow('unsupported effort');
    await flush();
    test.outcome('rejected');
    await assertion;
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });
  it('times out without treating silence as acceptance, and takes the control back', async () => {
    vi.useFakeTimers();
    const test = session();
    const result = confirmSessionControl(test.value, action);
    const assertion = expect(result).rejects.toThrow('did not confirm');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(test.refresh).toHaveBeenCalledTimes(2);
    expect(test.retract).toHaveBeenCalledExactlyOnceWith('action');
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });
  it('gives up on time even when the final log read never answers', async () => {
    vi.useFakeTimers();
    const test = session();
    test.refresh.mockImplementation(() => new Promise(() => {}));
    const result = confirmSessionControl(test.value, action);
    const assertion = expect(result).rejects.toThrow('did not confirm');
    await vi.advanceTimersByTimeAsync(70_000);
    await assertion;
    expect(test.retract).toHaveBeenCalledExactlyOnceWith('action');
  });
  it('confirms from the refetched log when the live feed missed the answer', async () => {
    vi.useFakeTimers();
    const test = session();
    const done = vi.fn();
    test.refresh.mockImplementation(async () => test.settleQuietly('accepted'));
    const result = confirmSessionControl(test.value, action).then(done);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(test.refresh).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(done).toHaveBeenCalledOnce();
    expect(test.retract).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.refresh).toHaveBeenCalledOnce();
  });
  it('records a settle the refetched log folded as the reread, not the feed', async () => {
    vi.useFakeTimers();
    const test = session();
    // The session tells its listeners about the refetched log well before the
    // refresh resolves, as `AgentSession.refresh` does: it still drains and
    // may fetch again.
    test.refresh.mockImplementation(async () => {
      test.outcome('accepted');
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const result = confirmSessionControl(test.value, action);
    await vi.advanceTimersByTimeAsync(10_050);
    await result;
    expect(spanAttributes.get('agent.control.settled_by')).toBe('refresh');
    expect(spanAttributes.get('agent.control.refreshes')).toBe(1);
  });
  it('records a settle the live feed delivered as the feed', async () => {
    const test = session();
    const result = confirmSessionControl(test.value, action);
    await flush();
    test.outcome('accepted');
    await result;
    expect(spanAttributes.get('agent.control.settled_by')).toBe('feed');
    expect(spanAttributes.get('agent.control.refreshes')).toBe(0);
  });
  it('fails immediately on HTTP rejection', async () => {
    const test = session();
    test.issue.mockResolvedValue(err([{ message: 'disconnected' }]));
    await expect(confirmSessionControl(test.value, action)).rejects.toThrow(
      'disconnected'
    );
  });
});
