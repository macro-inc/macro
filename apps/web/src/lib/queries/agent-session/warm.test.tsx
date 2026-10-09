/** @vitest-environment jsdom */
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { WarmAgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  replenishWarmAgentSession,
  takeWarmAgentSession,
  useWarmAgentSessionQuery,
} from './warm';

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
      status: { kind: 'no_messages' },
      workspace: '/workspace',
    },
  });
}

function setup() {
  const client = new QueryClient();
  clients.push(client);
  const claim = (options: Parameters<typeof takeWarmAgentSession>[0] = {}) =>
    takeWarmAgentSession({ userId: OWNER, ...options }, client);
  const take = (options: Parameters<typeof takeWarmAgentSession>[0] = {}) =>
    claim(options).id;
  const replenish = () => replenishWarmAgentSession(OWNER, client);
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
  return { claim, take, replenish, settled, mount };
}

it('does not warm for an owner who has no existing warming query', () => {
  const { replenish } = setup();
  replenish();
  expect(warm).not.toHaveBeenCalled();
});

it('retries a failed initial preparation only after successful creation', async () => {
  warm.mockRejectedValueOnce(new Error('offline'));
  warm.mockResolvedValueOnce(prepared('recovered'));
  const { mount, settled, take, replenish } = setup();
  mount();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(take()).toBeUndefined();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);

  replenish();
  await settled();
  expect(warm).toHaveBeenCalledTimes(2);
  expect(take()).toBe('recovered');
  await settled();
  expect(warm).toHaveBeenCalledTimes(2);
});

it('deduplicates page mounts and preserves a reservation for the matching owner and settings', async () => {
  warm.mockResolvedValueOnce(prepared('warm-id'));
  const { mount, settled, claim, take, replenish } = setup();
  mount();
  mount();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(claim({ userId: 'other' })).toEqual({ claim: 'miss_none_ready' });
  expect(claim({ userId: undefined })).toEqual({ claim: 'not_attempted' });
  expect(claim({ botId: 'another-bot' })).toEqual({ claim: 'not_attempted' });
  expect(claim({ repoUrl: 'https://github.com/example/repo' })).toEqual({
    claim: 'not_attempted',
  });
  expect(claim({ modelOverride: 'different' })).toEqual({
    claim: 'miss_model',
  });
  expect(claim({ instructions: 'different' })).toEqual({
    claim: 'miss_other',
  });
  replenish();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(claim({ botId: MACRO_NEW_BOT_ID, modelOverride: 'model-a' })).toEqual({
    id: 'warm-id',
    claim: 'hit',
  });
  expect(take()).toBeUndefined();
  await settled();
});

it('waits for the claim to release capacity before preparing one shared replacement', async () => {
  const replacement = Promise.withResolvers<ReturnType<typeof prepared>>();
  let claimComplete = false;
  warm.mockResolvedValueOnce(prepared('first'));
  // The owner already has two reservations. Only a completed claim frees a slot.
  warm.mockImplementationOnce(async () =>
    claimComplete ? replacement.promise : ok({ session: null })
  );
  const { mount, settled, take, replenish } = setup();
  mount();
  mount();
  await settled();
  expect(take()).toBe('first');
  expect(take()).toBeUndefined();
  // The destination can mount while POST /agent-sessions is still pending.
  mount();
  await settled();
  expect(warm).toHaveBeenCalledTimes(1);
  claimComplete = true;
  replenish();
  await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(2));
  mount();
  expect(warm).toHaveBeenCalledTimes(2);
  replacement.resolve(prepared('second'));
  await settled();
  expect(take()).toBe('second');
  expect(take()).toBeUndefined();
  replenish();
  await settled();
  expect(warm).toHaveBeenCalledTimes(3);
});

it('keeps the same in-flight replacement across navigation to another warming surface', async () => {
  const replacement = Promise.withResolvers<ReturnType<typeof prepared>>();
  warm.mockResolvedValueOnce(prepared('first'));
  warm.mockReturnValueOnce(replacement.promise);
  const { mount, settled, take, replenish } = setup();
  const leaveHome = mount();
  await settled();
  expect(take()).toBe('first');
  replenish();
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
    const { mount, settled, take, replenish } = setup();
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
    replenish();
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
    const { mount, settled, take, replenish } = setup();
    mount();
    await settled();
    expect(take()).toBe('first');
    replenish();
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
  const { mount, settled, take, replenish } = setup();
  const unmount = mount();
  await settled();
  unmount();
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000);
  mount();
  await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(2));
  expect(take()).toBeUndefined();
  now.mockRestore();
  replenish();
  expect(warm).toHaveBeenCalledTimes(2);
  replacement.resolve(prepared('second'));
  await settled();
  expect(take()).toBe('second');
  await settled();
});
