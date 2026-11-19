import { prepareResponseObservers } from '@core/util/response-observers';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { onlineManager } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  proof: vi.fn(),
  retire: vi.fn(),
  refetch: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getLegacyUserPermissions: mocks.auth },
}));
vi.mock('./client', () => ({ dssFetch: mocks.proof }));
vi.mock('@queries/client', () => ({
  queryPersistence: { retire: mocks.retire },
  queryClient: { refetchQueries: mocks.refetch, cancelQueries: mocks.cancel },
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: {
    'document-storage-service': 'http://localhost/dss',
    'email-service': 'http://localhost/email',
    'agent-harness': 'http://localhost/agent',
  },
}));

import { crmAccessAuthority } from './crm-access-authority';
import {
  initializeCrmCacheOwner,
  installCrmCacheHost,
  setCrmAccessSession,
} from './crm-access-cache';

const TEAM = '00000000-0000-4000-8000-000000000001';
function owner(policy: string | null = null) {
  let state: CacheAuthority = {
    identity: 'profile',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy,
    ready: policy !== null,
  };
  const listeners = new Set<(value: CacheAuthority) => void>();
  const authority: CacheAuthorityHost = {
    current: async () => state,
    snapshot: () => state,
    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async transition(expected, policy) {
      if (expected !== state.generation) throw new StaleCacheAuthorityError();
      const changed = state.policy !== policy;
      const generationChanged =
        changed && (state.policy !== null || policy.endsWith(':denied'));
      state = {
        ...state,
        policy,
        ready: true,
        generation: generationChanged ? crypto.randomUUID() : state.generation,
      };
      for (const listener of listeners) listener(state);
      return { authority: state, revision: '0', affectedOps: [], changed };
    },
  };
  const host = { ...createNoopCacheHost(), disabled: false, authority };
  installCrmCacheHost(host);
  return host;
}
const allowed = () => ok({ team_id: TEAM, allowed: true });
beforeEach(() => {
  mocks.auth.mockReset();
  mocks.proof.mockReset();
  mocks.retire.mockReset();
  mocks.refetch.mockReset();
  mocks.cancel.mockReset();
  mocks.retire.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
});
afterEach(async () => {
  crmAccessAuthority.setSession(undefined);
  installCrmCacheHost(undefined);
  onlineManager.setOnline(true);
  await cacheSessionGeneration.transition(async () => {});
});
async function boot(policy: string | null = null) {
  const host = owner(policy);
  mocks.proof.mockResolvedValue(allowed());
  setCrmAccessSession('viewer');
  await crmAccessAuthority.refresh();
  return host;
}

it('does not refetch or reset active reads for a safe first owner without a mirror', async () => {
  const host = owner();
  const generation = host.authority.snapshot()!.generation;
  await initializeCrmCacheOwner();
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  // Main has a bound account but no authority policy or mirror. Its persisted
  // email/CRM entries and mounted readers survive recovery and the first proof.
  expect(mocks.retire).not.toHaveBeenCalled();
  mocks.cancel.mockClear();
  mocks.refetch.mockClear();
  mocks.proof.mockResolvedValue(allowed());
  setCrmAccessSession('viewer');
  const read = prepareResponseObservers('http://localhost/email/threads', {
    method: 'GET',
  });
  const response = read(Response.json({ subject: 'Personal mail' }));
  await crmAccessAuthority.refresh();
  expect(host.authority.snapshot()!.generation).toBe(generation);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(mocks.retire).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({ subject: 'Personal mail' });
});

it('uses one proof for a scripted inbox, thread, draft and realtime session', async () => {
  await boot();
  const requests: [string, string][] = [
    ['email/threads', 'GET'],
    ['email/threads/thread-a', 'GET'],
    ['email/threads/thread-b', 'GET'],
    ['email/drafts/draft-a', 'PATCH'],
    ['email/drafts/draft-a', 'PATCH'],
    ['email/drafts/draft-a', 'PATCH'],
    ['email/threads/thread-a/read', 'PATCH'],
    ['email/threads/thread-a/star', 'PATCH'],
    ['email/labels', 'GET'],
    ['email/folders', 'GET'],
    ['agent/activity', 'GET'],
    ['dss/soup', 'POST'],
  ];
  for (const [route, method] of requests) {
    setCrmAccessSession('viewer');
    const guard = prepareResponseObservers(`http://localhost/${route}`, {
      method,
    });
    expect(guard).not.toBeInstanceOf(Promise);
    if (guard instanceof Promise) throw new Error('response dispatch waited');
    const response = guard(
      Response.json(
        { ok: true },
        { headers: { 'x-macro-crm-access': `${TEAM}:allowed` } }
      )
    );
    expect(response).not.toBeInstanceOf(Promise);
    expect(await (await response).json()).toEqual({ ok: true });
  }
  expect(mocks.proof).toHaveBeenCalledTimes(1);
  expect(mocks.retire).not.toHaveBeenCalled();
});

it('refetches only after the latest overlapping retirement finishes', async () => {
  const host = await boot();
  mocks.refetch.mockClear();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  mocks.cancel.mockImplementationOnce(() => {
    firstStarted.resolve();
    return first.promise;
  });
  mocks.cancel.mockImplementationOnce(() => {
    secondStarted.resolve();
    return second.promise;
  });
  await host.authority.transition(
    host.authority.snapshot()!.generation,
    `${TEAM}:denied`
  );
  await firstStarted.promise;
  await host.authority.transition(
    host.authority.snapshot()!.generation,
    `${TEAM}:allowed`
  );
  first.resolve();
  await secondStarted.promise;
  try {
    expect(mocks.refetch).not.toHaveBeenCalled();
  } finally {
    second.resolve();
    await crmAccessAuthority.refresh();
  }
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it.each(['pending', 'failed'] as const)(
  'does not delay signature, mark-read, star or folder writes while the first proof is %s',
  async (mode) => {
    owner();
    const pending = Promise.withResolvers<ReturnType<typeof allowed>>();
    const started = Promise.withResolvers<void>();
    mocks.proof.mockImplementation(() => {
      started.resolve();
      return pending.promise;
    });
    setCrmAccessSession('viewer');
    await started.promise;
    const failed =
      mode === 'failed'
        ? expect(crmAccessAuthority.refresh()).rejects.toThrow()
        : undefined;
    if (mode === 'failed') {
      pending.reject(new Error('proof unavailable'));
      await failed;
    }
    for (const route of [
      'signature',
      'mark-read',
      'star',
      'labels',
      'folders',
    ]) {
      const guard = prepareResponseObservers(
        `http://localhost/email/${route}`,
        { method: 'PATCH' }
      );
      expect(guard).not.toBeInstanceOf(Promise);
      if (guard instanceof Promise)
        throw new Error('mail write waited for proof');
      const response = guard(Response.json({ saved: true }));
      expect(response).not.toBeInstanceOf(Promise);
      expect(await (await response).json()).toEqual({ saved: true });
    }
    if (mode === 'pending') {
      pending.resolve(allowed());
      await crmAccessAuthority.refresh();
    }
    expect(mocks.proof).toHaveBeenCalledOnce();
  }
);

it('retires on a mismatched hint in the background and does not retry per response', async () => {
  await boot();
  mocks.proof.mockClear();
  const pending = Promise.withResolvers<ReturnType<typeof allowed>>();
  mocks.proof.mockReturnValue(pending.promise);
  for (let index = 0; index < 20; index++) {
    const guard = await prepareResponseObservers(
      'http://localhost/email/signature',
      { method: 'PATCH' }
    );
    const response = guard(
      Response.json(
        { saved: true },
        { headers: { 'x-macro-crm-access': `${TEAM}:denied` } }
      )
    );
    expect(response).not.toBeInstanceOf(Promise);
    expect(await (await response).json()).toEqual({ saved: true });
  }
  expect(mocks.proof).toHaveBeenCalledOnce();
  pending.resolve(ok({ team_id: TEAM, allowed: false }));
  await crmAccessAuthority.refresh();
  expect(crmAccessAuthority.state()).toBe('denied');
  expect(mocks.retire).toHaveBeenCalledOnce();
});

it('rejects an older REST read after retirement while preserving a write outcome', async () => {
  await boot();
  const read = await prepareResponseObservers(
    'http://localhost/email/threads',
    { method: 'GET' }
  );
  const write = await prepareResponseObservers(
    'http://localhost/email/signature',
    { method: 'PATCH' }
  );
  const response = await read(Response.json({ body: 'previous snapshot' }));
  const saved = await write(Response.json({ saved: true }));
  mocks.proof.mockResolvedValue(ok({ team_id: TEAM, allowed: false }));
  await crmAccessAuthority.refresh();
  await expect(response.json()).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  await expect(saved.json()).resolves.toEqual({ saved: true });
});

it('fences a response immediately on logout without waiting for disk retirement', async () => {
  await boot();
  const read = prepareResponseObservers('http://localhost/email/threads', {});
  const response = read(Response.json({ body: 'previous account' }));
  const retirement = Promise.withResolvers<void>();
  mocks.retire.mockReturnValue(retirement.promise);
  setCrmAccessSession(undefined);
  await expect(response.json()).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  expect(crmAccessAuthority.state()).toBe('pending');
  retirement.resolve();
  await cacheSessionGeneration.transition(async () => {});
});

it('retries an initial failed proof on reconnect without holding mailbox responses', async () => {
  owner();
  mocks.proof.mockResolvedValue(err([{ code: 'SERVER_ERROR' }]));
  setCrmAccessSession('viewer');
  await expect(crmAccessAuthority.refresh()).rejects.toThrow();
  expect(crmAccessAuthority.state()).toBe('error');
  mocks.proof.mockResolvedValue(allowed());
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await crmAccessAuthority.refresh();
  expect(crmAccessAuthority.state()).toBe('allowed');
  expect(mocks.proof).toHaveBeenCalledTimes(2);
});

it('refreshes after a CRM 403 while keeping the last policy on a failed proof', async () => {
  await boot();
  mocks.proof.mockResolvedValue(err([{ code: 'SERVER_ERROR' }]));
  const guard = await prepareResponseObservers(
    'http://localhost/dss/crm/companies'
  );
  guard(new Response(null, { status: 403 }));
  await expect(crmAccessAuthority.refresh()).rejects.toThrow();
  expect(crmAccessAuthority.state()).toBe('allowed');
});
