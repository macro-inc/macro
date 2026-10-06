/**
 * @vitest-environment jsdom
 *
 * The two shapes a block id can have — a session, or a placeholder standing
 * in for one being created — resolved into the one the block consumes.
 */

import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refetchSoupEntity = vi.hoisted(() => vi.fn(async () => {}));
// Session creation refreshes Soup in the background. Keep this unit test at
// the query boundary so real auth/network work cannot outlive its environment.
vi.mock('@queries/soup/normalized-cache', () => ({ refetchSoupEntity }));

const create = vi.hoisted(() => ({
  resolve: undefined as ((id?: string) => void) | undefined,
  reject: undefined as (() => void) | undefined,
  control: vi.fn(),
  autoConfirm: true,
  confirm: undefined as ((error?: string) => void) | undefined,
  release: vi.fn(),
  attribution: vi.fn(),
  confirmedModel: undefined as string | undefined,
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    create: vi.fn(
      (request: { id: string }) =>
        new Promise((resolve) => {
          create.resolve = (id: string = request.id) =>
            resolve({
              isErr: () => false,
              value: { session: { id, ownerId: 'session-owner' } },
            });
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

vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: (id: string) => {
      let requestId: string | undefined;
      let outcome: { kind: string; message?: string } = { kind: 'pending' };
      let listener: (() => void) | undefined;
      create.confirm = (error) => {
        outcome = error
          ? { kind: 'rejected', message: error }
          : { kind: 'accepted' };
        listener?.();
      };
      return {
        load: async () => {},
        issue: async (action: AgentAction, options: unknown) => {
          create.attribution(options);
          const result = await create.control(id, action);
          if (!result.isErr()) {
            requestId = result.value.actionId;
            outcome = { kind: create.autoConfirm ? 'accepted' : 'pending' };
          }
          return result;
        },
        snapshot: async () => ({
          messages: requestId
            ? [
                {
                  requestId,
                  pending: false,
                  parts: [{ kind: 'control', outcome }],
                },
              ]
            : [],
          metadata: {
            model: create.confirmedModel,
            configOptions: [
              {
                id: 'effort',
                name: 'Effort',
                category: 'thought_level',
                type: 'select',
                currentValue: 'low',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'ultra', name: 'Ultra' },
                ],
              },
            ],
          },
        }),
        subscribe: (callback: () => void) => {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
        release: create.release,
      };
    },
  },
}));

const { forgetPendingSession, startPendingSession } = await import(
  './pending-session'
);
const { PromptTrace } = await import('@core/agent-session/prompt-telemetry');
const { agentHarnessServiceClient } = await import(
  '@service-agent-harness/client'
);
const { resolveSessionId } = await import('./resolve-session-id');

/** Let the mocked create's `.then` run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  refetchSoupEntity.mockClear();
  create.control.mockReset();
  create.release.mockReset();
  create.autoConfirm = true;
  create.confirm = undefined;
  create.confirmedModel = undefined;
});

afterEach(() => {
  for (const [request] of vi.mocked(agentHarnessServiceClient.create).mock
    .calls) {
    if (request.id) forgetPendingSession(request.id);
  }
});

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
  it('sends immediately when the runtime already confirms the requested model and effort', async () => {
    create.confirmedModel = 'model-2';
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'prompt', status: 'sent' },
    });
    const placeholder = startPendingSession({
      prompt: 'Hello',
      modelOverride: 'model-2',
      effortOverride: { configId: 'effort', value: 'low' },
    });
    create.resolve?.();
    await flush();
    expect(create.control.mock.calls).toEqual([
      [placeholder, { type: 'prompt', prompt: 'Hello' }],
    ]);
    expect(create.release).toHaveBeenCalledTimes(1);
  });

  it('keeps initial context as a draft after startup without issuing a prompt', async () => {
    const placeholder = startPendingSession({
      initialInput: 'Document context ',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      expect(resolved.initialInput()).toBe('Document context ');
      expect(resolved.pendingPrompt()).toBeUndefined();
      create.resolve?.();
      await flush();
      expect(resolved.initialInput()).toBe('Document context ');
      expect(resolved.pending()).toBe(false);
      expect(create.control).not.toHaveBeenCalled();
      dispose();
    });
  });

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
      expect(refetchSoupEntity).toHaveBeenCalledExactlyOnceWith(
        placeholder,
        'agentSession',
        { created: true }
      );
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
      expect(refetchSoupEntity).toHaveBeenCalledExactlyOnceWith(
        'server-minted',
        'agentSession',
        { created: true }
      );
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
      expect(refetchSoupEntity).not.toHaveBeenCalled();
      dispose();
    });
  });

  // A model chosen before the session exists is sent at creation and confirmed
  // before the first prompt, so that prompt runs on the requested model.
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
        [placeholder, { type: 'setModel', model: 'model-2' }],
        [placeholder, { type: 'prompt', prompt: 'Fix the tests' }],
      ]);
      expect(resolved.sessionId()).toBe(placeholder);
      dispose();
    });
  });

  // Context a surface supplies for the agent rides on the session as its
  // instructions, so the composer and the sent bubble hold only the user's text.
  it('creates the session with hidden instructions and its model, leaving the draft visible', async () => {
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'action-1', status: 'accepted' },
    });
    const placeholder = startPendingSession({
      initialInput: 'Ask about Offsite ',
      modelOverride: 'model-2',
      instructions: 'Use the Offsite database by default.',
    });
    expect(agentHarnessServiceClient.create).toHaveBeenLastCalledWith({
      id: placeholder,
      model: 'model-2',
      instructions: 'Use the Offsite database by default.',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.();
      await flush();
      await flush();

      expect(create.control.mock.calls).toEqual([
        [placeholder, { type: 'setModel', model: 'model-2' }],
      ]);
      expect(resolved.initialInput()).toBe('Ask about Offsite ');
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

  it('waits for model and effort confirmation before sending the first prompt', async () => {
    create.autoConfirm = false;
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'control', status: 'accepted' },
    });
    const placeholder = startPendingSession({
      modelOverride: 'model-2',
      effortOverride: { configId: 'effort', value: 'ultra' },
      prompt: 'Hello',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.('session-confirm');
      await flush();
      expect(create.control.mock.calls).toEqual([
        ['session-confirm', { type: 'setModel', model: 'model-2' }],
      ]);
      expect(resolved.pending()).toBe(true);
      create.confirm?.();
      await flush();
      expect(create.control.mock.calls).toEqual([
        ['session-confirm', { type: 'setModel', model: 'model-2' }],
        [
          'session-confirm',
          { type: 'setConfigOption', configId: 'effort', value: 'ultra' },
        ],
      ]);
      expect(resolved.pending()).toBe(true);
      create.confirm?.();
      await flush();
      expect(create.control).toHaveBeenLastCalledWith('session-confirm', {
        type: 'prompt',
        prompt: 'Hello',
      });
      expect(resolved.sessionId()).toBe('session-confirm');
      expect(create.release).toHaveBeenCalledOnce();
      dispose();
    });
  });

  it('does not send the prompt when the runtime rejects an HTTP-accepted change', async () => {
    create.autoConfirm = false;
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'control', status: 'accepted' },
    });
    const placeholder = startPendingSession({
      effortOverride: { configId: 'effort', value: 'ultra' },
      prompt: 'Hello',
    });
    await createRoot(async (dispose) => {
      const resolved = resolveSessionId(() => placeholder);
      create.resolve?.('session-reject');
      await flush();
      create.confirm?.('Effort is unavailable.');
      await flush();
      expect(resolved.error()).toBe('Effort is unavailable.');
      expect(create.control).toHaveBeenCalledTimes(1);
      expect(create.release).toHaveBeenCalledOnce();
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

it.each([undefined, 'explicit-user'])(
  'attributes the first prompt when userId is %s',
  async (userId) => {
    create.attribution.mockClear();
    create.control.mockResolvedValue({
      isErr: () => false,
      value: { actionId: 'prompt-id' },
    });
    startPendingSession({ prompt: 'Hello', userId });
    create.resolve?.();
    await flush();
    expect(create.attribution).toHaveBeenCalledWith({
      userId: userId ?? 'session-owner',
      trace: expect.any(PromptTrace),
    });
  }
);
