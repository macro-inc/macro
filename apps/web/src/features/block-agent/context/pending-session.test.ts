import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  control: vi.fn(),
  remember: vi.fn(),
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: api,
}));
vi.mock('@queries/agent-session/recent-sessions', () => ({
  rememberAgentSession: api.remember,
}));

import { pendingSession, startPendingSession } from './pending-session';

beforeEach(() => vi.clearAllMocks());

it('adds a provisioned session to recents and sends the first prompt without a mounted view', async () => {
  let resolve!: (value: unknown) => void;
  api.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  api.control.mockResolvedValue({ isErr: () => false });
  const id = startPendingSession('Hello');
  expect(pendingSession(id)?.sessionId()).toBeUndefined();
  expect(api.control).not.toHaveBeenCalled();
  const session = {
    id: 'real',
    ownerId: 'viewer',
    name: 'Agent Session',
    modifiedAt: '2026-09-08',
  };
  resolve({ isErr: () => false, value: { session } });
  await vi.waitFor(() =>
    expect(api.control).toHaveBeenCalledWith('real', {
      type: 'prompt',
      prompt: 'Hello',
    })
  );
  expect(api.remember).toHaveBeenCalledWith('viewer', session);
  expect(pendingSession(id)?.sessionId()).toBe('real');
});

it('retains a failed initial prompt for retry', async () => {
  api.create.mockResolvedValue({
    isErr: () => false,
    value: { session: { id: 'retry', ownerId: 'viewer' } },
  });
  api.control
    .mockResolvedValueOnce({ isErr: () => true })
    .mockResolvedValueOnce({ isErr: () => false });
  const id = startPendingSession('Keep this prompt');
  await vi.waitFor(() => expect(pendingSession(id)?.promptFailed()).toBe(true));
  expect(pendingSession(id)?.initialPrompt).toBe('Keep this prompt');
  await pendingSession(id)?.retryPrompt();
  expect(pendingSession(id)?.promptFailed()).toBe(false);
  expect(api.control).toHaveBeenCalledTimes(2);
});
