import type { AgentSession } from '@core/agent-session/AgentSession';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  };
  return {
    value: value as unknown as AgentSession,
    issue: value.issue,
    unsubscribe,
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
afterEach(() => vi.useRealTimers());
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
  it('times out without treating silence as acceptance', async () => {
    vi.useFakeTimers();
    const test = session();
    const result = confirmSessionControl(test.value, action);
    const assertion = expect(result).rejects.toThrow('did not confirm');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });
  it('fails immediately on HTTP rejection', async () => {
    const test = session();
    test.issue.mockResolvedValue(err([{ message: 'disconnected' }]));
    await expect(confirmSessionControl(test.value, action)).rejects.toThrow(
      'disconnected'
    );
  });
});
