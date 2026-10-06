/** @vitest-environment jsdom */
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { WarmAgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { takeWarmAgentSession, useWarmAgentSessionQuery } from './warm';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { warm: vi.fn() },
}));

const OWNER = 'warm-test-user';
const warm = vi.mocked(agentHarnessServiceClient.warm);
const disposers = new Set<() => void>();
const clients: QueryClient[] = [];

beforeEach(() => {
  warm.mockResolvedValue(ok({ session: null }));
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function prepared(id: string) {
  return ok<WarmAgentSessionResponse>({
    session: {
      id,
      model: 'model-a',
      instructions: null,
      botId: MACRO_NEW_BOT_ID,
      canEdit: true,
      createdAt: '2026-10-06T00:00:00Z',
      modifiedAt: '2026-10-06T00:00:00Z',
      harness: 'in-memory',
      isArchived: false,
      name: '',
      ownerId: OWNER,
      sandboxSize: 'default',
      status: { kind: 'unknown' },
      workspace: '/workspace',
    },
  });
}

function setup() {
  const client = new QueryClient();
  clients.push(client);
  const take = (options: Parameters<typeof takeWarmAgentSession>[0] = {}) =>
    takeWarmAgentSession({ userId: OWNER, ...options }, client);
  const settled = () => vi.waitFor(() => expect(client.isFetching()).toBe(0));
  const mount = () => {
    const Hook = () => {
      useWarmAgentSessionQuery(() => OWNER);
      return null;
    };
    const dispose = render(
      () => (
        <QueryClientProvider client={client}>
          <Hook />
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    const unmount = () => {
      disposers.delete(unmount);
      dispose();
    };
    disposers.add(unmount);
    return unmount;
  };
  return { take, settled, mount };
}

it('deduplicates page mounts and preserves a reservation for the matching owner and settings', async () => {
  warm.mockResolvedValueOnce(prepared('warm-id'));
  const { mount, settled, take } = setup();
  mount();
  mount();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(take({ userId: 'other' })).toBeUndefined();
  expect(take({ userId: undefined })).toBeUndefined();
  expect(take({ botId: 'another-bot' })).toBeUndefined();
  expect(take({ repoUrl: 'https://github.com/example/repo' })).toBeUndefined();
  expect(take({ modelOverride: 'different' })).toBeUndefined();
  expect(take({ instructions: 'different' })).toBeUndefined();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(take({ botId: MACRO_NEW_BOT_ID, modelOverride: 'model-a' })).toBe(
    'warm-id'
  );
  expect(take()).toBeUndefined();
  await settled();
});

it('prepares one shared replacement for a second conversation while a warming surface stays mounted', async () => {
  const replacement = Promise.withResolvers<ReturnType<typeof prepared>>();
  warm.mockResolvedValueOnce(prepared('first'));
  warm.mockReturnValueOnce(replacement.promise);
  const { mount, settled, take } = setup();
  mount();
  mount();
  await settled();
  expect(take()).toBe('first');
  expect(take()).toBeUndefined();
  await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(2));
  mount();
  expect(warm).toHaveBeenCalledTimes(2);
  replacement.resolve(prepared('second'));
  await settled();
  expect(take()).toBe('second');
  expect(take()).toBeUndefined();
  await settled();
  expect(warm).toHaveBeenCalledTimes(3);
});

it('keeps the same in-flight replacement across navigation to another warming surface', async () => {
  const replacement = Promise.withResolvers<ReturnType<typeof prepared>>();
  warm.mockResolvedValueOnce(prepared('first'));
  warm.mockReturnValueOnce(replacement.promise);
  const { mount, settled, take } = setup();
  const leaveHome = mount();
  await settled();
  expect(take()).toBe('first');
  await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(2));
  leaveHome();
  mount();
  replacement.resolve(prepared('second'));
  await settled();
  expect(warm).toHaveBeenCalledTimes(2);
  expect(take()).toBe('second');
  await settled();
});

it.each(['consumed', 'expired'] as const)(
  'waits for a new observer before replacing an inactive %s reservation',
  async (reason) => {
    warm.mockResolvedValueOnce(prepared('first'));
    warm.mockResolvedValueOnce(prepared('second'));
    const { mount, settled, take } = setup();
    const unmount = mount();
    await settled();
    unmount();
    if (reason === 'expired') {
      const now = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + 5 * 60_000);
      expect(take()).toBeUndefined();
      now.mockRestore();
    } else {
      expect(take()).toBe('first');
    }
    await settled();
    expect(warm).toHaveBeenCalledTimes(1);
    expect(take()).toBeUndefined();
    mount();
    mount();
    await settled();
    expect(warm).toHaveBeenCalledTimes(2);
    expect(take()).toBe('second');
    await settled();
  }
);

it.each(['empty', 'failed'] as const)(
  'does not loop when replacement preparation returns %s',
  async (result) => {
    warm.mockResolvedValueOnce(prepared('first'));
    if (result === 'failed') warm.mockRejectedValueOnce(new Error('offline'));
    const { mount, settled, take } = setup();
    mount();
    await settled();
    expect(take()).toBe('first');
    await settled();
    expect(warm).toHaveBeenCalledTimes(2);
    expect(take()).toBeUndefined();
    expect(take()).toBeUndefined();
    await settled();
    expect(warm).toHaveBeenCalledTimes(2);
  }
);

it('joins an in-flight refresh when an expired reservation is discarded', async () => {
  const replacement = Promise.withResolvers<ReturnType<typeof prepared>>();
  warm.mockResolvedValueOnce(prepared('first'));
  warm.mockReturnValueOnce(replacement.promise);
  const { mount, settled, take } = setup();
  const unmount = mount();
  await settled();
  unmount();
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000);
  mount();
  await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(2));
  expect(take()).toBeUndefined();
  now.mockRestore();
  expect(warm).toHaveBeenCalledTimes(2);
  replacement.resolve(prepared('second'));
  await settled();
  expect(take()).toBe('second');
  await settled();
});
