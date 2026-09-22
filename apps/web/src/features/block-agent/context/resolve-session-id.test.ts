/**
 * @vitest-environment jsdom
 *
 * The two shapes a block id can have — a session, or a placeholder standing
 * in for one being created — resolved into the one the block consumes.
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

const { startPendingSession } = await import('./pending-session');
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

describe('a placeholder', () => {
  it('has no session until the create lands, then has that one', async () => {
    const placeholder = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      expect(resolved.sessionId()).toBeUndefined();
      expect(resolved.pending()).toBe(true);
      expect(resolved.failed()).toBe(false);

      create.resolve?.('session-9');
      await flush();

      expect(resolved.sessionId()).toBe('session-9');
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  it('fails when the create fails', async () => {
    const placeholder = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
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
    const placeholder = startPendingSession({
      botId: 'persona-1',
      modelOverride: 'model-2',
      prompt: 'Fix the tests',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
    expect(agentHarnessServiceClient.create).toHaveBeenLastCalledWith({
      botId: 'persona-1',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.('session-10');
      await flush();
      await flush();

      expect(create.control.mock.calls).toEqual([
        ['session-10', { type: 'setModel', model: 'model-2' }],
        ['session-10', { type: 'prompt', prompt: 'Fix the tests' }],
      ]);
      expect(resolved.sessionId()).toBe('session-10');
      dispose();
    });
  });

  it('shows a model failure without sending the prompt on the wrong model', async () => {
    create.control.mockResolvedValue({
      isErr: () => true,
      error: [{ code: 'HTTP_ERROR', message: 'Model is unavailable.' }],
    });
    const placeholder = startPendingSession({
      modelOverride: 'missing',
      prompt: 'Hello',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.('session-model-error');
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
    const placeholder = startPendingSession({ prompt: 'Hello' });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.('session-prompt-error');
      await flush();
      expect(resolved.error()).toBe('Runtime is disconnected.');
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  // A placeholder URL reloaded in a new tab: the create it named belonged to
  // the tab that is gone, so there is nothing to wait for.
  it('with no create behind it is a failure, not a wait', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(() => 'pending-nothing');
      expect(resolved.pending()).toBe(false);
      expect(resolved.failed()).toBe(true);
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
    startPendingSession({ prompt, attachments });
    create.resolve?.('session-image');
    await flush();
    expect(create.control).toHaveBeenCalledWith('session-image', {
      type: 'prompt',
      prompt,
      attachments,
    });
  }
);
