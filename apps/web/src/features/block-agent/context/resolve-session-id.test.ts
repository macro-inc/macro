/**
 * @vitest-environment jsdom
 *
 * The two shapes a block id can have — a session, or a placeholder standing
 * in for one being created — resolved into the one the block consumes.
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => ({
  resolve: undefined as ((id?: string) => void) | undefined,
  reject: undefined as (() => void) | undefined,
  control: vi.fn(),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    create: vi.fn(
      (request: { id: string }) =>
        new Promise((resolve) => {
          create.resolve = (id: string = request.id) =>
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

// The first prompt goes through the shared session so it is folded
// speculatively; here that is just the control POST under the session's id.
vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: (id: string) => ({
      issue: (action: unknown) => create.control(id, action),
      release: () => {},
    }),
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

describe('an id whose create is in flight', () => {
  it('has no session until the create lands, then is that session', async () => {
    const placeholder = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      expect(resolved.sessionId()).toBeUndefined();
      expect(resolved.pending()).toBe(true);
      expect(resolved.failed()).toBe(false);

      create.resolve?.();
      await flush();

      expect(resolved.sessionId()).toBe(placeholder);
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  // A service that predates client-minted ids answers with its own; the
  // block adopts that one exactly as it adopted a placeholder's before.
  it('adopts the id the service answers with when it differs', async () => {
    const minted = startPendingSession();
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => minted);
      create.resolve?.('server-minted');
      await flush();
      expect(resolved.sessionId()).toBe('server-minted');
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

  // A model chosen before the session exists is what the session is created
  // on, not something switched afterwards: the first prompt is the only thing
  // sent, so it opens the session's first turn and the session gets a name.
  it('creates the session on the chosen model', async () => {
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
      id: placeholder,
      botId: 'persona-1',
      model: 'model-2',
      repoUrl: 'https://github.com/macro-inc/macro',
      repoBranch: 'feature/home',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.();
      await flush();
      await flush();

      expect(create.control.mock.calls).toEqual([
        [placeholder, { type: 'prompt', prompt: 'Fix the tests' }],
      ]);
      expect(resolved.sessionId()).toBe(placeholder);
      dispose();
    });
  });

  // The prompt shows as sent from the block's own speculation the moment the
  // session exists; the block must not wait for the harness to accept it.
  it('has the session as soon as the create lands, prompt still on the wire', async () => {
    let deliver: ((result: unknown) => void) | undefined;
    create.control.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve;
      })
    );
    const placeholder = startPendingSession({ prompt: 'Hello' });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      expect(resolved.pendingPrompt()).toBe('Hello');
      create.resolve?.();
      await flush();
      expect(resolved.sessionId()).toBe(placeholder);
      expect(resolved.pending()).toBe(false);
      expect(create.control).toHaveBeenCalledTimes(1);
      deliver?.({
        isErr: () => false,
        value: { actionId: 'action-11', status: 'accepted' },
      });
      await flush();
      expect(resolved.failed()).toBe(false);
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
      create.resolve?.();
      await flush();
      expect(resolved.error()).toBe('Runtime is disconnected.');
      expect(resolved.pending()).toBe(false);
      dispose();
    });
  });

  // The id is final from the start, so a URL reloaded in another tab names a
  // real session: it loads (or fails to) like any other, never a dead end.
  it('with no create behind it in this tab is a session to load', () => {
    createRoot((dispose) => {
      const resolved = resolveSessionId(() => 'reloaded-elsewhere');
      expect(resolved.sessionId()).toBe('reloaded-elsewhere');
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
    create.resolve?.();
    await flush();
    expect(create.control).toHaveBeenCalledWith(id, {
      type: 'prompt',
      prompt,
      attachments,
    });
  }
);
