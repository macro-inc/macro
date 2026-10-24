import type { ConnectingReply } from '@core/pipedream/connection-context';
import type { PipedreamConnectOutcome } from '@queries/pipedream-connectors';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createConnectorContinuation } from './create-connector-continuation';

function setup(
  resumes?: (reply: ConnectingReply | undefined) => boolean | Promise<boolean>
) {
  let finish!: (outcome: PipedreamConnectOutcome) => void;
  const outcome = new Promise<PipedreamConnectOutcome>((resolve) => {
    finish = resolve;
  });
  const deps = {
    disabled: () => false,
    revision: () => 'session:message',
    resumes,
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
const reply = { messageId: 'reply-1', postedAt: '2026-10-05T10:01:00Z' };
const notResumed =
  'Linear connected. Send a message when you are ready to continue.';

/** A decision on whether to carry on that waits until `answer` is called. */
function deciding() {
  let answer: ((resumes: boolean) => void) | undefined;
  const resumes = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
  );
  return {
    resumes,
    answer: (value: boolean) => {
      if (!answer) throw new Error('not asked yet');
      answer(value);
    },
  };
}

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
    'does not resume a session that is %s',
    async (state) => {
      const { deps, flow, finish, dispose } = setup();
      const pending = flow.connect(app);
      if (state === 'changed') deps.revision = () => 'session:new-message';
      if (state === 'generating') deps.disabled = () => true;
      if (state === 'unmounted') dispose();
      finish('connected');
      await pending;
      expect(deps.resume).not.toHaveBeenCalled();
      if (state !== 'unmounted') dispose();
    }
  );

  it('connects but does not resume from a reply the surface cannot resume from', async () => {
    const resumes = vi.fn(() => false);
    const { deps, flow, finish, dispose } = setup(resumes);
    const pending = flow.connect(app, reply);
    finish('connected');
    await pending;
    expect(resumes).toHaveBeenCalledExactlyOnceWith(reply);
    expect(deps.resume).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(notResumed);
    expect(flow.resumed().size).toBe(0);
    dispose();
  });

  it('asks whether to carry on once the app is connected, and waits for the answer', async () => {
    const decision = deciding();
    const { deps, flow, finish, dispose } = setup(decision.resumes);
    const pending = flow.connect(app, reply);
    await Promise.resolve();
    expect(decision.resumes).not.toHaveBeenCalled();
    finish('connected');
    await vi.waitFor(() => expect(decision.resumes).toHaveBeenCalledOnce());
    expect(deps.resume).not.toHaveBeenCalled();
    expect(flow.connecting()).toBe('linear');
    decision.answer(true);
    await pending;
    expect(deps.resume).toHaveBeenCalledExactlyOnceWith('Linear');
    dispose();
  });

  it.each(['changed', 'generating', 'unmounted'] as const)(
    'does not resume a session that is %s by the time it decides',
    async (state) => {
      const decision = deciding();
      const { deps, flow, finish, dispose } = setup(decision.resumes);
      const pending = flow.connect(app, reply);
      finish('connected');
      await vi.waitFor(() => expect(decision.resumes).toHaveBeenCalledOnce());
      if (state === 'changed') deps.revision = () => 'session:new-message';
      if (state === 'generating') deps.disabled = () => true;
      if (state === 'unmounted') dispose();
      decision.answer(true);
      await pending;
      expect(deps.resume).not.toHaveBeenCalled();
      if (state === 'unmounted') return;
      expect(deps.notify).toHaveBeenCalledWith(notResumed);
      dispose();
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
    expect(flow.failed()).toBe('linear');
    dispose();
  });

  it('says which app is signing in, and which one the agent carried on with', async () => {
    const { flow, finish, dispose } = setup();
    const pending = flow.connect(app);
    expect(flow.connecting()).toBe('linear');
    finish('connected');
    await pending;
    expect(flow.connecting()).toBeUndefined();
    expect(flow.failed()).toBeUndefined();
    expect([...flow.resumed()]).toEqual(['linear']);
    dispose();
  });

  it('treats a closed sign-in as no attempt, and a new attempt clears a failure', async () => {
    const { deps, flow, dispose } = setup();
    deps.connect = vi.fn(async (): Promise<PipedreamConnectOutcome> => {
      throw new Error('registration failed');
    });
    await flow.connect(app);
    expect(flow.failed()).toBe('linear');
    deps.connect = vi.fn(
      async (): Promise<PipedreamConnectOutcome> => 'closed'
    );
    await flow.connect(app);
    expect(flow.failed()).toBeUndefined();
    expect(flow.resumed().size).toBe(0);
    dispose();
  });
});
