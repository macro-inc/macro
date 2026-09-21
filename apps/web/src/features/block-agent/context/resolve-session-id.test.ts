/**
 * @vitest-environment jsdom
 *
 * The two shapes a block id can have — a session, or a client-minted id
 * standing in for one being created — resolved into the one the block consumes.
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => ({
  resolve: undefined as ((id: string) => void) | undefined,
  reject: undefined as (() => void) | undefined,
  control: vi.fn(),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    create: vi.fn(
      () =>
        new Promise((resolve) => {
          create.resolve = (id: string) =>
            resolve({ isErr: () => false, value: { session: { id } } });
          create.reject = () =>
            resolve({
              isErr: () => true,
              error: [
                {
                  code: 'HTTP_ERROR',
                  message: 'Connect GitHub to use this repository.',
                },
              ],
            });
        })
    ),
    control: create.control,
  },
}));

const { pendingSession, startPendingSession } = await import(
  './pending-session'
);
const { agentHarnessServiceClient } = await import(
  '@service-agent-harness/client'
);
const { resolveSessionId } = await import('./resolve-session-id');

/** Let the mocked create's `.then` run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => create.control.mockReset());

describe('a block id that is already a session', () => {
  it('resolves to itself, never pending', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(() => 'session-1');
      expect(resolved.sessionId()).toBe('session-1');
      expect(resolved.pending()).toBe(false);
      expect(resolved.failed()).toBe(false);
      dispose();
    });
  });
});

describe('a client-minted id', () => {
  it('is a uuid posted as the create id', () => {
    const id = startPendingSession();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(agentHarnessServiceClient.create).toHaveBeenLastCalledWith({
      id,
    });
  });

  it('has no session until the create lands, then has that one', async () => {
    const id = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      expect(resolved.sessionId()).toBeUndefined();
      expect(resolved.pending()).toBe(true);
      expect(resolved.failed()).toBe(false);

      create.resolve?.(id);
      await flush();

      expect(resolved.sessionId()).toBe(id);
      expect(resolved.pending()).toBe(false);
      expect(pendingSession(id)).toBeUndefined();
      dispose();
    });
  });

  it('keeps the pending entry when the server returns a different id', async () => {
    const id = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      create.resolve?.('server-minted-id');
      await flush();

      expect(resolved.sessionId()).toBe('server-minted-id');
      expect(pendingSession(id)?.sessionId()).toBe('server-minted-id');
      dispose();
    });
  });

  it('fails when the create fails', async () => {
    const id = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      create.reject?.();
      await flush();

      expect(resolved.failed()).toBe(true);
      expect(resolved.pending()).toBe(false);
      expect(resolved.error()).toBe('Connect GitHub to use this repository.');
      expect(resolved.sessionId()).toBeUndefined();
      dispose();
    });
  });

  it('applies a model override before delivering the first prompt', async () => {
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'action-1', status: 'accepted' },
    });
    const id = startPendingSession({
      botId: 'persona-1',
      modelOverride: 'model-2',
      prompt: 'Fix the tests',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
    expect(agentHarnessServiceClient.create).toHaveBeenLastCalledWith({
      id,
      botId: 'persona-1',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      create.resolve?.(id);
      await flush();
      await flush();

      expect(create.control.mock.calls).toEqual([
        [id, { type: 'setModel', model: 'model-2' }],
        [id, { type: 'prompt', prompt: 'Fix the tests' }],
      ]);
      expect(resolved.sessionId()).toBe(id);
      dispose();
    });
  });

  it('shows a model failure without sending the prompt on the wrong model', async () => {
    create.control.mockResolvedValue({
      isErr: () => true,
      error: [{ code: 'HTTP_ERROR', message: 'Model is unavailable.' }],
    });
    const id = startPendingSession({
      modelOverride: 'missing',
      prompt: 'Hello',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      create.resolve?.(id);
      await flush();
      expect(resolved.error()).toBe('Model is unavailable.');
      expect(resolved.pending()).toBe(false);
      expect(create.control).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('shows the first prompt failure', async () => {
    create.control.mockResolvedValue({
      isErr: () => true,
      error: [{ code: 'HTTP_ERROR', message: 'Runtime is disconnected.' }],
    });
    const id = startPendingSession({ prompt: 'Hello' });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => id);
      create.resolve?.(id);
      await flush();
      expect(resolved.error()).toBe('Runtime is disconnected.');
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  // A session URL whose create belonged to another tab: nothing is pending
  // here, so the id is already a session and the GET decides if it exists.
  it('with no create behind it is a session, not a wait', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(
        () => '0199a0ac-ab5e-7d6f-91ca-16997a26d13a'
      );
      expect(resolved.sessionId()).toBe('0199a0ac-ab5e-7d6f-91ca-16997a26d13a');
      expect(resolved.pending()).toBe(false);
      expect(resolved.failed()).toBe(false);
      dispose();
    });
  });
});

it.each(['Describe this', ''])(
  'delivers first-prompt attachments with text %j',
  async (prompt) => {
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'image-action', status: 'accepted' },
    });
    const attachments = [
      {
        uri: 'https://static.macro.com/file/image-id',
        name: 'pasted.png',
        mimeType: 'image/png',
      },
    ];
    const id = startPendingSession({ prompt, attachments });
    create.resolve?.(id);
    await flush();
    expect(create.control).toHaveBeenCalledWith(id, {
      type: 'prompt',
      prompt,
      attachments,
    });
  }
);
