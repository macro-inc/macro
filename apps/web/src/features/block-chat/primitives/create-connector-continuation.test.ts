import type { PipedreamConnectOutcome } from '@queries/pipedream-connectors';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createConnectorContinuation } from './create-connector-continuation';

function setup() {
  let finish!: (outcome: PipedreamConnectOutcome) => void;
  const outcome = new Promise<PipedreamConnectOutcome>((resolve) => {
    finish = resolve;
  });
  const deps = {
    disabled: () => false,
    revision: () => 'chat:message',
    connect: vi.fn(() => outcome),
    resume: vi.fn(async () => {}),
    notify: vi.fn(),
  };
  let dispose!: () => void;
  const flow = createRoot((cleanup) => {
    dispose = cleanup;
    return createConnectorContinuation(deps);
  });
  return { deps, flow, finish, dispose };
}
const app = { appSlug: 'linear', name: 'Linear' };

describe('connector continuation', () => {
  it('waits for verified completion and continues exactly once', async () => {
    const { deps, flow, finish, dispose } = setup();
    const pending = flow.connect(app);
    await flow.connect(app);
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(deps.resume).not.toHaveBeenCalled();
    finish('connected');
    await pending;
    expect(deps.resume).toHaveBeenCalledExactlyOnceWith('Linear');
    expect(flow.disabled()).toBe(false);
    dispose();
  });

  it.each(['closed', 'unsupported'] as const)(
    'does not resume after %s',
    async (outcome) => {
      const { deps, flow, finish, dispose } = setup();
      const pending = flow.connect(app);
      finish(outcome);
      await pending;
      expect(deps.resume).not.toHaveBeenCalled();
      dispose();
    }
  );

  it.each(['changed', 'generating', 'unmounted'] as const)(
    'does not resume a chat that is %s',
    async (state) => {
      const { deps, flow, finish, dispose } = setup();
      const pending = flow.connect(app);
      if (state === 'changed') deps.revision = () => 'chat:new-message';
      if (state === 'generating') deps.disabled = () => true;
      if (state === 'unmounted') dispose();
      finish('connected');
      await pending;
      expect(deps.resume).not.toHaveBeenCalled();
      if (state !== 'unmounted') dispose();
    }
  );

  it('reports registration failure without sending a continuation', async () => {
    const { deps, flow, dispose } = setup();
    deps.connect = vi.fn(async () => {
      throw new Error('registration failed');
    });
    await flow.connect(app);
    expect(deps.resume).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(flow.disabled()).toBe(false);
    dispose();
  });
});
