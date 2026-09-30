import type { AgentSession } from '@core/agent-session/AgentSession';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { configureSessionModel } from './configure-session-model';

function fixture() {
  let listener = () => {};
  const config = {
    id: 'cursor_effort',
    type: 'select',
    category: 'thought_level',
    currentValue: 'low',
    options: [{ value: 'low' }, { value: 'ultra' }],
  };
  const snapshot = {
    metadata: { model: 'old', configOptions: [config] },
    messages: [] as unknown[],
  };
  const issue = vi.fn(async (_action: AgentAction) =>
    ok({ actionId: `action-${issue.mock.calls.length}`, status: 'sent' })
  );
  const session = {
    issue,
    snapshot: async () => snapshot,
    subscribe: (callback: () => void) => {
      listener = callback;
      return () => {};
    },
  } as unknown as AgentSession;
  return {
    session,
    issue,
    snapshot,
    config,
    confirm(action: number, kind = 'accepted') {
      snapshot.messages.push({
        requestId: `action-${action}`,
        pending: false,
        parts: [
          { kind: 'control', outcome: { kind, message: 'Model rejected' } },
        ],
      });
      listener();
    },
  };
}
const selection = { configId: 'cursor_effort', value: 'ultra' };
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('combined model and effort selection', () => {
  it('waits for the model confirmation before issuing the opaque effort, then waits for effort confirmation', async () => {
    const f = fixture();
    let finished = false;
    const result = (async () => {
      await configureSessionModel(f.session, 'new', selection);
      finished = true;
    })();
    await flush();
    expect(f.issue.mock.calls).toEqual([[{ type: 'setModel', model: 'new' }]]);
    f.snapshot.metadata.model = 'new';
    f.confirm(1);
    await flush();
    expect(f.issue.mock.calls[1]).toEqual([
      { type: 'setConfigOption', ...selection },
    ]);
    expect(finished).toBe(false);
    f.confirm(2);
    await result;
    expect(finished).toBe(true);
  });
  it('does not send effort after the model is rejected', async () => {
    const f = fixture();
    const result = configureSessionModel(f.session, 'new', selection);
    const assertion = expect(result).rejects.toThrow('Model rejected');
    await flush();
    f.confirm(1, 'rejected');
    await assertion;
    expect(f.issue).toHaveBeenCalledTimes(1);
  });
  it('revalidates discovery against the confirmed model snapshot', async () => {
    const f = fixture();
    const result = configureSessionModel(f.session, 'new', selection);
    const assertion = expect(result).rejects.toThrow('no longer supports');
    await flush();
    f.snapshot.metadata.model = 'new';
    f.snapshot.metadata.configOptions = [];
    f.confirm(1);
    await assertion;
    expect(f.issue).toHaveBeenCalledTimes(1);
  });
  it('changes only effort for the current model and skips an already selected value', async () => {
    const f = fixture();
    await configureSessionModel(f.session, 'old', {
      ...selection,
      value: 'low',
    });
    expect(f.issue).not.toHaveBeenCalled();
    const result = configureSessionModel(f.session, 'old', selection);
    await flush();
    expect(f.issue).toHaveBeenCalledWith({
      type: 'setConfigOption',
      ...selection,
    });
    f.confirm(1);
    await result;
  });
});
