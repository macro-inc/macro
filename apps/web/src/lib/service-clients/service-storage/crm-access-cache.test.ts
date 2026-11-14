import { prepareResponseObservers } from '@core/util/response-observers';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import {
  assertResponseAuthority,
  hasResponseAuthority,
  queuedSettlementRequest,
  responseAuthorityGeneration,
} from '@graphql-cache/response-authority';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  proof: vi.fn(),
  retire: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getLegacyUserPermissions: mocks.auth },
}));
vi.mock('./client', () => ({ dssFetch: mocks.proof }));
vi.mock('@queries/client', () => ({
  queryPersistence: { retire: mocks.retire },
  queryClient: { refetchQueries: mocks.refetch },
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: {
    'document-storage-service': 'http://localhost/dss',
    'email-service': 'http://localhost/email',
    'agent-harness': 'http://localhost/agent',
  },
}));

import { crmAccessAuthority } from './crm-access-authority';
import { installCrmCacheHost } from './crm-access-cache';

function owner(account: string) {
  let state: CacheAuthority = {
    identity: 'profile',
    account,
    ready: false,
    policy: null,
    generation: crypto.randomUUID(),
  };
  const listeners = new Set<(state: CacheAuthority) => void>();
  const authority: CacheAuthorityHost = {
    current: async () => state,
    snapshot: () => state,
    setReadGuard: () => {},
    verifyRead: async () => {},
    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async transition(expected, policy) {
      if (expected !== state.generation) throw new StaleCacheAuthorityError();
      const changed = !state.ready || state.policy !== policy;
      if (changed) {
        state = {
          ...state,
          policy,
          ready: true,
          generation: crypto.randomUUID(),
        };
        for (const listener of listeners) listener(state);
      }
      return { authority: state, changed, revision: '0', affectedOps: [] };
    },
  };
  const writeQuery = vi.fn(createNoopCacheHost().writeQuery);
  installCrmCacheHost({
    ...createNoopCacheHost(),
    disabled: false,
    authority,
    writeQuery,
  });
  return { authority, writeQuery };
}
beforeEach(() => {
  mocks.auth.mockReset();
  mocks.proof.mockReset();
  mocks.retire.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
});
afterEach(() => {
  crmAccessAuthority.setSession(undefined);
  installCrmCacheHost(undefined);
});

describe('CRM HTTP response admission', () => {
  it('does not let a tab with restored old account state reset the current account cache', async () => {
    const current = owner('current-account');
    crmAccessAuthority.setSession('stale-account');
    mocks.auth.mockResolvedValue(
      ok({ authenticated: true, userId: 'current-account' })
    );
    await expect(
      prepareResponseObservers('http://localhost/dss/graphql')
    ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(current.writeQuery).not.toHaveBeenCalled();
    expect(current.authority.snapshot()?.account).toBe('current-account');
  });

  it('fences an account proof that finishes after the session changed', async () => {
    const current = owner('previous-account');
    crmAccessAuthority.setSession('next-account');
    const identity = Promise.withResolvers<unknown>();
    mocks.auth.mockReturnValue(identity.promise);
    const preparing = prepareResponseObservers('http://localhost/dss/graphql');
    await vi.waitFor(() => expect(mocks.auth).toHaveBeenCalledOnce());
    crmAccessAuthority.setSession('later-account');
    identity.resolve(ok({ authenticated: true, userId: 'next-account' }));
    await expect(preparing).rejects.toBeInstanceOf(StaleCacheAuthorityError);
    expect(current.writeQuery).not.toHaveBeenCalled();
  });

  it('settles a successful queued response after proof failure without giving its content a valid token', async () => {
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql',
      queuedSettlementRequest({ method: 'POST' })
    );
    mocks.proof.mockResolvedValue(err(new Error('offline')));
    const response = await observe(
      new Response('{"data":{"id":"canonical","name":"copied content"}}')
    );
    expect(await response.json()).toEqual({
      data: { id: 'canonical', name: 'copied content' },
    });
    expect(hasResponseAuthority(response)).toBe(true);
    expect(responseAuthorityGeneration(response)).toBeUndefined();
    await expect(assertResponseAuthority(response)).rejects.toThrow(
      'Unable to verify CRM access'
    );
  });

  it('rejects the same successful response when it is not a durable queued settlement', async () => {
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql',
      { method: 'POST' }
    );
    mocks.proof.mockResolvedValue(err(new Error('offline')));
    await expect(
      observe(new Response('{"data":{"id":"canonical"}}'))
    ).rejects.toThrow('Unable to verify CRM access');
  });
});
