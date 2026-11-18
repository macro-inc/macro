import {
  passResponse,
  prepareResponseObservers,
} from '@core/util/response-observers';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { rememberOwnedEmail } from '@graphql-cache/authority-scope';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import {
  assertResponseAuthority,
  hasResponseAuthority,
  isQueuedSettlementRequest,
  queuedSettlementRequest,
  responseAuthorityGeneration,
} from '@graphql-cache/response-authority';
import { emailKeys } from '@queries/email/keys';
import { setupQueryPersistence } from '@queries/persistence';
import { reminderKeys } from '@queries/reminders/keys';
import { soupKeys } from '@queries/soup/keys';
import { QueryObserver } from '@tanstack/query-core';
import { onlineManager, QueryClient } from '@tanstack/solid-query';
import { createClient, gql } from '@urql/core';
import type { Client as GraphqlWsClient } from 'graphql-ws';
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
import { graphqlSoupSubscriptionExchange } from './crm-subscription-exchange';

const TEAM = '00000000-0000-4000-8000-000000000001';
const personalFolder = {
  ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
  emailView: 'spam',
};
const emailReminder =
  'http://localhost/dss/reminders/email/00000000-0000-4000-8000-000000000001';
const proof = (allowed: boolean) => ok({ team_id: TEAM, allowed });
const responseWithHint = (allowed: boolean) =>
  Response.json(
    { data: { id: 'canonical', name: 'copied content' } },
    {
      headers: {
        'x-macro-crm-access': `${TEAM}:${allowed ? 'allowed' : 'denied'}`,
      },
    }
  );

async function verifiedViewer(allowed = true) {
  const current = owner('viewer');
  crmAccessAuthority.setSession('viewer');
  mocks.proof.mockResolvedValue(proof(allowed));
  await crmAccessAuthority.refresh();
  mocks.proof.mockClear();
  return current;
}

function owner(account: string) {
  let state: CacheAuthority = {
    identity: 'profile',
    account,
    ready: false,
    policy: null,
    generation: crypto.randomUUID(),
  };
  const listeners = new Set<(state: CacheAuthority) => void>();
  let readGuard: () => Promise<unknown> = async () => {};
  const authority: CacheAuthorityHost = {
    current: async () => state,
    snapshot: () => state,
    setReadGuard: (guard) => {
      readGuard = guard;
    },
    verifyRead: async () => {
      await readGuard();
    },
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
  onlineManager.setOnline(true);
});

describe('CRM HTTP response admission', () => {
  it.each([
    [false, 'email'],
    [true, 'email'],
    [false, 'soup'],
    [true, 'soup'],
    [false, 'reminder'],
    [true, 'reminder'],
    [false, 'reminderCollection'],
    [true, 'reminderCollection'],
  ] as const)(
    'restarts mounted independent snapshots after sign-in without proof, logout=%s kind=%s',
    async (logout, kind) => {
      vi.useFakeTimers();
      await verifiedViewer();
      await vi.runOnlyPendingTimersAsync();
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });
      const persistence = setupQueryPersistence({ queryClient, scopes: [] });
      mocks.retire.mockImplementation(persistence.retire);
      mocks.refetch.mockImplementation((options) =>
        queryClient.refetchQueries(options)
      );
      const fetchInbox = vi.fn(async () => 'current-inbox');
      const fetchCrm = vi.fn(async () => 'protected-data');
      const keys = {
        email: emailKeys.messageInbox('message').queryKey,
        soup: soupKeys.astItems({
          params: {},
          body: personalFolder,
          transport: 'rest',
        }).queryKey,
        reminder: reminderKeys.email('thread').queryKey,
        reminderCollection: reminderKeys.emailCollection('viewer', {}).queryKey,
      };
      const inbox = new QueryObserver(queryClient, {
        queryKey: keys[kind],
        queryFn: fetchInbox,
        initialData: 'previous-inbox',
        staleTime: Infinity,
      });
      const crm = new QueryObserver(queryClient, {
        queryKey: ['crm', 'companies'],
        queryFn: fetchCrm,
        initialData: 'previous-protected-data',
        staleTime: Infinity,
      });
      const stopInbox = inbox.subscribe(() => {});
      const stopCrm = crm.subscribe(() => {});
      try {
        mocks.proof.mockClear();
        if (logout) {
          crmAccessAuthority.setSession(undefined);
          await vi.runOnlyPendingTimersAsync();
          expect(inbox.getCurrentResult().data).toBeUndefined();
          expect(fetchInbox).not.toHaveBeenCalled();
        }
        crmAccessAuthority.setSession('viewer', 1);
        await vi.runOnlyPendingTimersAsync();
        expect(inbox.getCurrentResult().data).toBe('current-inbox');
        expect(fetchInbox).toHaveBeenCalledOnce();
        expect(crm.getCurrentResult().data).toBeUndefined();
        expect(fetchCrm).not.toHaveBeenCalled();
        expect(mocks.proof).not.toHaveBeenCalled();
      } finally {
        stopInbox();
        stopCrm();
        persistence.dispose();
        queryClient.clear();
        mocks.retire.mockResolvedValue(undefined);
        mocks.refetch.mockResolvedValue(undefined);
        vi.useRealTimers();
      }
    }
  );

  it('keeps mailbox metadata on denial but retires it when the login is replaced', async () => {
    const mailKeys = [
      emailKeys.threadOperations('thread').queryKey,
      emailKeys.messageOperation('message').queryKey,
      emailKeys.threadReadReceipts('thread').queryKey,
      emailKeys.messageInbox('message').queryKey,
      soupKeys.astItems({ params: {}, body: personalFolder }).queryKey,
      reminderKeys.email('thread').queryKey,
      reminderKeys.emailCollection('viewer', {}).queryKey,
    ];
    const crmKey = ['crm', 'companies'];
    const visible = new Map<readonly unknown[], string>(
      [...mailKeys, crmKey].map((key) => [key, 'previous login content'])
    );
    mocks.retire.mockImplementation(
      async (matches: (key: readonly unknown[]) => boolean) => {
        for (const key of visible.keys()) if (matches(key)) visible.delete(key);
      }
    );
    await verifiedViewer();
    mocks.proof.mockResolvedValue(proof(false));
    await crmAccessAuthority.refresh();
    expect(visible.has(crmKey)).toBe(false);
    for (const key of mailKeys) expect(visible.has(key)).toBe(true);
    crmAccessAuthority.setSession('replacement');
    expect(visible.size).toBe(0);
  });

  it.each(['pending', 'unavailable', 'denied'] as const)(
    'keeps personal mailbox reads and writes independent while CRM proof is %s',
    async (state) => {
      const current = owner('viewer');
      crmAccessAuthority.setSession('viewer');
      if (state === 'denied') {
        mocks.proof.mockResolvedValue(proof(false));
        await crmAccessAuthority.refresh();
      } else if (state === 'unavailable') {
        mocks.proof.mockResolvedValue(
          err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
        );
        await expect(crmAccessAuthority.refresh()).rejects.toThrow();
      }
      const readAuthority = vi.spyOn(current.authority, 'current');
      mocks.proof.mockClear();
      for (const [url, init] of [
        [
          'http://localhost/email/email/settings',
          { method: 'PATCH', body: '{"signature":"test"}' },
        ],
        [
          'http://localhost/email/email/messages/batch',
          { method: 'POST', body: '{"ids":["message"]}' },
        ],
        ['http://localhost/email/email/threads/thread/messages', {}],
        [emailReminder, {}],
        [emailReminder, { method: 'PUT' }],
        ['http://localhost/dss/reminders/email/collection', {}],
        [
          'http://localhost/dss/items/soup/ast',
          { method: 'POST', body: JSON.stringify(personalFolder) },
        ],
        [
          'http://localhost/dss/graphql',
          queuedSettlementRequest({
            method: 'POST',
            body: JSON.stringify({
              query:
                'mutation { markEmailThreadSeen(input: {threadId: "thread"}) { ...State } } fragment State on GraphqlSoupEmailThread { id isRead }',
            }),
          }),
        ],
      ] satisfies [string, RequestInit][]) {
        const observe = prepareResponseObservers(url, init);
        expect(observe).not.toBeInstanceOf(Promise);
        const response = Response.json({ saved: true });
        expect(await (await (await observe)(response)).json()).toEqual({
          saved: true,
        });
        expect(hasResponseAuthority(response)).toBe(false);
      }
      expect(readAuthority).not.toHaveBeenCalled();
      expect(mocks.proof).not.toHaveBeenCalled();
      readAuthority.mockRestore();
    }
  );

  for (const phase of ['headers', 'body'] as const) {
    for (const nextAccount of ['viewer', 'replacement']) {
      it.each([
        ['http://localhost/email/email/settings', { method: 'PATCH' }],
        ['http://localhost/email/email/threads/thread/read-receipts', {}],
        ['http://localhost/email/email/threads/session-thread', {}],
        [emailReminder, {}],
        [emailReminder, { method: 'PUT' }],
        ['http://localhost/dss/reminders/email/collection', {}],
        [
          'http://localhost/dss/items/soup/ast',
          { method: 'POST', body: JSON.stringify(personalFolder) },
        ],
        [
          'http://localhost/dss/graphql',
          {
            method: 'POST',
            body: JSON.stringify({
              query:
                'mutation { markEmailThreadSeen(input:{threadId:"thread"}) { id isRead } }',
            }),
          },
        ],
        [
          'http://localhost/dss/graphql',
          queuedSettlementRequest({
            method: 'POST',
            body: JSON.stringify({
              query:
                'mutation { markEmailThreadSeen(input:{threadId:"thread"}) { id isRead } }',
            }),
          }),
        ],
      ] satisfies [string, RequestInit][])(
        `keeps the login fence when %s ${phase} finish after signing in as ${nextAccount}`,
        async (url, init) => {
          const current = owner('viewer');
          crmAccessAuthority.setSession('viewer');
          let ownershipCurrent = true;
          rememberOwnedEmail('session-thread', () => ownershipCurrent);
          const lookup = vi.spyOn(current.authority, 'current');
          const observe = await prepareResponseObservers(url, init);
          const response = Response.json({ body: 'previous login content' });
          const decoding = Promise.withResolvers<unknown>();
          response.json = () => decoding.promise;
          const body =
            phase === 'body' ? (await observe(response)).json() : undefined;
          ownershipCurrent = false;
          crmAccessAuthority.setSession(nextAccount, 1);
          if (isQueuedSettlementRequest(init)) {
            // A successful durable command must still settle its returned IDs,
            // while its old-login content cannot be published.
            decoding.resolve({ body: 'previous login content' });
            await expect(
              body ?? (await observe(response)).json()
            ).resolves.toEqual({
              body: 'previous login content',
            });
            await expect(
              assertResponseAuthority(response)
            ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
            expect(responseAuthorityGeneration(response)).toBe(
              '00000000-0000-0000-0000-000000000000'
            );
          } else if (phase === 'headers')
            await expect(
              Promise.resolve().then(() => observe(response))
            ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
          else {
            decoding.resolve({ body: 'previous login content' });
            await expect(body).rejects.toBeInstanceOf(StaleCacheAuthorityError);
          }
          expect(lookup).not.toHaveBeenCalled();
          expect(mocks.proof).not.toHaveBeenCalled();
          lookup.mockRestore();
        }
      );
    }
  }

  it('rejects a null proof as a terminal error without a network retry', async () => {
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    mocks.proof.mockResolvedValue(ok(null));
    await expect(crmAccessAuthority.refresh()).rejects.toThrow(
      'Unable to verify CRM access'
    );
    expect(mocks.proof).toHaveBeenCalledTimes(1);
    expect(crmAccessAuthority.state()).toBe('error');
  });

  it('retries a failed initial proof when the online manager reconnects', async () => {
    onlineManager.setOnline(false);
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
    await expect(crmAccessAuthority.refresh()).rejects.toThrow(
      'Unable to verify CRM access'
    );
    expect(crmAccessAuthority.state()).toBe('error');
    const recovered = Promise.withResolvers<void>();
    const stop = crmAccessAuthority.onVerified(() => recovered.resolve());
    mocks.proof.mockResolvedValue(proof(true));
    onlineManager.setOnline(true);
    await recovered.promise;
    stop();
    expect(crmAccessAuthority.state()).toBe('allowed');
    expect(mocks.proof).toHaveBeenCalledTimes(2);
  });

  it('bounds proof requests across an email session and preserves offline cache reads', async () => {
    const current = await verifiedViewer();
    const counts: Record<string, number> = { login: 1 };
    for (const [phase, requests] of [
      ['inbox', 1],
      ['threads', 5],
      ['autosave', 3],
    ] as const) {
      const before = mocks.proof.mock.calls.length;
      for (let index = 0; index < requests; index++) {
        const autosave = phase === 'autosave';
        const observe = await prepareResponseObservers(
          autosave
            ? 'http://localhost/dss/items/soup/graphql'
            : `http://localhost/email/email/threads/thread-${index}`,
          autosave
            ? {
                method: 'POST',
                body: JSON.stringify({
                  query: 'mutation Save { saveEmailDraft { draftId } }',
                }),
              }
            : {}
        );
        await (
          await observe(
            autosave ? responseWithHint(true) : Response.json({ id: index })
          )
        ).json();
      }
      counts[phase] = mocks.proof.mock.calls.length - before;
    }
    const connected =
      Promise.withResolvers<Parameters<GraphqlWsClient['subscribe']>[1]>();
    let delivered = Promise.withResolvers<void>();
    const beforeSubscription = mocks.proof.mock.calls.length;
    const client = createClient({
      url: '/graphql',
      exchanges: [
        graphqlSoupSubscriptionExchange(
          {
            subscribe(_payload, sink) {
              connected.resolve(sink);
              return () => {};
            },
          },
          (document) => document
        ),
      ],
    });
    const subscription = client
      .subscription(
        gql`subscription Activity { activityUpdates { ... on GraphqlActivityEvent { id } } }`,
        {}
      )
      .subscribe(() => delivered.resolve());
    try {
      const sink = await connected.promise;
      for (let index = 0; index < 10; index++) {
        delivered = Promise.withResolvers<void>();
        sink.next({ data: { activityUpdates: [{ id: `event-${index}` }] } });
        await delivered.promise;
      }
      counts.realtime = mocks.proof.mock.calls.length - beforeSubscription;
      const beforeReads = mocks.proof.mock.calls.length;
      for (let index = 0; index < 10; index++)
        await current.authority.verifyRead();
      counts.cacheReads = mocks.proof.mock.calls.length - beforeReads;
      console.info('CRM_PROOF_SESSION', JSON.stringify(counts));
      expect(mocks.proof.mock.calls.length).toBe(0);
      mocks.proof.mockRejectedValue(new Error('offline'));
      await expect(current.authority.verifyRead()).resolves.toBeUndefined();
      expect(mocks.proof.mock.calls.length).toBe(0);
    } finally {
      subscription.unsubscribe();
    }
  });
  it('prepares unrelated requests synchronously without a CRM proof', async () => {
    await verifiedViewer();
    const external = prepareResponseObservers(
      'https://unrelated.example/asset'
    );
    const independent = prepareResponseObservers(
      'http://localhost/dss/documents'
    );
    expect(external).not.toBeInstanceOf(Promise);
    expect(independent).not.toBeInstanceOf(Promise);
    expect(external).toBe(passResponse);
    expect(independent).toBe(passResponse);
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'revoked'] as const)(
    'returns a committed Soup mutation when the later proof is %s',
    async (state) => {
      await verifiedViewer();
      const observe = await prepareResponseObservers(
        'http://localhost/dss/items/soup/graphql',
        {
          method: 'POST',
          body: JSON.stringify({
            query:
              'mutation Save { setEntityProperty(input: {entityType: CRM_COMPANY}) { id } }',
          }),
        }
      );
      mocks.proof.mockResolvedValue(
        state === 'revoked'
          ? proof(false)
          : err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
      );
      const data = { data: { setEntityProperty: { id: 'property-1' } } };
      const response = await observe(Response.json(data));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(data);
      await expect(assertResponseAuthority(response)).rejects.toThrow();
      expect(crmAccessAuthority.allowed()).toBe(state === 'unavailable');
    }
  );
  it.each(['headers', 'body'] as const)(
    'rejects CRM-bearing document attachment references revoked before %s finish',
    async (phase) => {
      await verifiedViewer();
      const request: RequestInit = {};
      const observe = await prepareResponseObservers(
        'http://localhost/dss/channels/attachments/document/document-1/references',
        request
      );
      expect(
        new Headers(request.headers).get('x-macro-crm-access-signal')
      ).toBe('1');
      const response = responseWithHint(true);
      const decoding = Promise.withResolvers<unknown>();
      response.json = () => decoding.promise;
      const body =
        phase === 'body' ? (await observe(response)).json() : undefined;
      mocks.proof.mockResolvedValue(proof(false));
      await crmAccessAuthority.refresh();
      if (phase === 'headers')
        await expect(observe(response)).rejects.toBeInstanceOf(
          StaleCacheAuthorityError
        );
      else {
        decoding.resolve({
          references: [{ message_content: 'Private record comment' }],
        });
        await expect(body).rejects.toBeInstanceOf(StaleCacheAuthorityError);
      }
    }
  );
  it('uses the verified owner snapshot when a redundant authority lookup would fail', async () => {
    const current = await verifiedViewer();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/crm/companies',
      { method: 'POST' }
    );
    const response = await observe(responseWithHint(true));
    vi.spyOn(current.authority, 'current').mockRejectedValueOnce(
      new Error('Owner unavailable')
    );
    await expect(assertResponseAuthority(response)).resolves.toBeUndefined();
    expect(crmAccessAuthority.allowed()).toBe(true);
    expect(await response.json()).toHaveProperty('data.id', 'canonical');
  });
  it('does not opt an unrelated document create into CRM proof or cache admission', async () => {
    const current = await verifiedViewer();
    const lookup = vi.spyOn(current.authority, 'current');
    const request: RequestInit = { method: 'POST' };
    const observe = await prepareResponseObservers(
      'http://localhost/dss/documents',
      request
    );
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
    const response = await observe(
      Response.json(
        { id: 'document-1', uploadUrl: 'http://localhost/upload' },
        { status: 201 }
      )
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 'document-1' });
    expect(new Headers(request.headers).has('x-macro-crm-access-signal')).toBe(
      false
    );
    expect(hasResponseAuthority(response)).toBe(false);
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'revoked'] as const)(
    'returns the committed create after proof is %s without admitting its content',
    async (state) => {
      await verifiedViewer();
      const observe = await prepareResponseObservers(
        'http://localhost/dss/crm/companies',
        { method: 'POST' }
      );
      mocks.proof.mockResolvedValue(
        state === 'revoked'
          ? proof(false)
          : err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
      );
      const response = await observe(
        Response.json(
          { id: 'company-1', name: 'Created once' },
          { status: 201 }
        )
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        id: 'company-1',
        name: 'Created once',
      });
      expect(crmAccessAuthority.allowed()).toBe(state === 'unavailable');
      expect(hasResponseAuthority(response)).toBe(true);
      expect(responseAuthorityGeneration(response)).toBeUndefined();
      await expect(assertResponseAuthority(response)).rejects.toBeDefined();
    }
  );

  it('preserves the actual rejected write status and payload when proof is unavailable', async () => {
    await verifiedViewer();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/crm/contacts',
      { method: 'POST' }
    );
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
    const response = await observe(
      Response.json({ message: 'Already exists' }, { status: 409 })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: 'Already exists' });
  });

  it.each(['/crm/companies', '/crm/contacts'])(
    'does not return an old login outcome from %s after same-account re-login',
    async (path) => {
      await verifiedViewer();
      const observe = await prepareResponseObservers(
        `http://localhost/dss${path}`,
        { method: 'POST' }
      );
      crmAccessAuthority.setSession(undefined);
      crmAccessAuthority.setSession('viewer');
      mocks.proof.mockResolvedValue(proof(true));
      await expect(
        Promise.resolve().then(() =>
          observe(Response.json({ id: 'created-before-login' }))
        )
      ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
    }
  );

  it('fences a write body that finishes decoding after login replacement', async () => {
    await verifiedViewer();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/crm/companies',
      { method: 'POST' }
    );
    const decoding = Promise.withResolvers<unknown>();
    const response = responseWithHint(true);
    response.json = () => decoding.promise;
    const admitted = await observe(response);
    const body = admitted.json();
    crmAccessAuthority.setSession('another-viewer');
    decoding.resolve({ id: 'old-login-result' });
    await expect(body).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  });

  it('opts in only for authenticated storage requests outside the proof endpoint', async () => {
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    const original = new Headers({ authorization: 'Bearer placeholder' });
    const init: RequestInit = { headers: original };
    await prepareResponseObservers('http://localhost/dss/graphql', init);
    expect(new Headers(init.headers).get('x-macro-crm-access-signal')).toBe(
      '1'
    );
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer placeholder'
    );
    expect(original.has('x-macro-crm-access-signal')).toBe(false);

    for (const url of [
      'http://localhost/dss/crm/member-access',
      'http://localhost/email/threads',
      'http://localhost/agent/agent-sessions/session/activity',
      'http://localhost/dss-other/graphql',
      'http://other.example/dss/graphql',
    ]) {
      const request = {};
      await prepareResponseObservers(url, request);
      expect(request).toEqual({});
    }
    crmAccessAuthority.setSession(undefined);
    const loggedOut = {};
    await prepareResponseObservers('http://localhost/dss/graphql', loggedOut);
    expect(loggedOut).toEqual({});
  });

  it('preserves Request headers and lets explicit init headers override them', async () => {
    owner('viewer');
    crmAccessAuthority.setSession('viewer');
    const input = new Request('http://localhost/dss/graphql', {
      headers: { 'x-source': 'request' },
    });
    const inherited: RequestInit = {};
    await prepareResponseObservers(input, inherited);
    expect(new Headers(inherited.headers).get('x-source')).toBe('request');
    expect(
      new Headers(inherited.headers).get('x-macro-crm-access-signal')
    ).toBe('1');
    const override: RequestInit = { headers: { 'x-source': 'init' } };
    await prepareResponseObservers(input, override);
    expect(new Headers(override.headers).get('x-source')).toBe('init');
    expect(input.headers.has('x-macro-crm-access-signal')).toBe(false);
  });

  it('admits an unchanged hint without another authority lookup', async () => {
    const current = await verifiedViewer();
    const generation = current.authority.snapshot()?.generation;
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql'
    );
    const response = await observe(responseWithHint(true));
    expect(await response.json()).toHaveProperty('data.id', 'canonical');
    expect(responseAuthorityGeneration(response)).toBe(generation);
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it.each([undefined, 'invalid'])(
    'refreshes an unavailable hint (%s) with network-only proof',
    async (hint) => {
      await verifiedViewer();
      const observe = await prepareResponseObservers(
        'http://localhost/dss/graphql'
      );
      const response = Response.json(
        {},
        {
          headers: hint ? { 'x-macro-crm-access': hint } : undefined,
        }
      );
      await observe(response);
      expect(mocks.proof).toHaveBeenCalledExactlyOnceWith(
        '/crm/member-access',
        expect.objectContaining({
          cache: 'no-store',
          signal: expect.any(AbortSignal),
        })
      );
    }
  );

  it('does not restore access from an older allowed hint after a fresh denial', async () => {
    const current = await verifiedViewer(false);
    const generation = current.authority.snapshot()?.generation;
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql'
    );
    const response = await observe(responseWithHint(true));
    expect(mocks.proof).toHaveBeenCalledOnce();
    expect(crmAccessAuthority.allowed()).toBe(false);
    expect(current.authority.snapshot()?.policy).toBe(`${TEAM}:denied`);
    expect(responseAuthorityGeneration(response)).toBe(generation);
  });

  it('retains the last verified proof after a transient failure when the hint is unchanged', async () => {
    await verifiedViewer();
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
    await expect(crmAccessAuthority.refresh()).rejects.toThrow(
      'Unable to verify CRM access'
    );
    expect(crmAccessAuthority.allowed()).toBe(true);
    mocks.proof.mockResolvedValue(proof(true)).mockClear();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql'
    );
    const response = await observe(responseWithHint(true));
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(crmAccessAuthority.allowed()).toBe(true);
    await expect(assertResponseAuthority(response)).resolves.toBeUndefined();
  });

  it.each([true, false])(
    'rejects an in-flight response when fresh access changes from %s',
    async (allowed) => {
      const current = await verifiedViewer(allowed);
      const generation = current.authority.snapshot()?.generation;
      const observe = await prepareResponseObservers(
        'http://localhost/dss/graphql'
      );
      mocks.proof.mockResolvedValue(proof(!allowed));
      await expect(observe(responseWithHint(!allowed))).rejects.toBeInstanceOf(
        StaleCacheAuthorityError
      );
      expect(current.authority.snapshot()?.generation).not.toBe(generation);
      expect(crmAccessAuthority.allowed()).toBe(!allowed);

      const retry = await prepareResponseObservers(
        'http://localhost/dss/graphql'
      );
      const response = await retry(responseWithHint(!allowed));
      expect(await response.json()).toHaveProperty('data.id', 'canonical');
      expect(responseAuthorityGeneration(response)).toBe(
        current.authority.snapshot()?.generation
      );
    }
  );

  it('rejects a delayed allowed response that arrives after another request verified denial', async () => {
    await verifiedViewer();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql'
    );
    mocks.proof.mockResolvedValue(proof(false));
    await crmAccessAuthority.refresh();
    await expect(observe(responseWithHint(true))).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(crmAccessAuthority.allowed()).toBe(false);
  });

  it('preserves queued identity settlement while rejecting content across a changed hint', async () => {
    await verifiedViewer();
    const observe = await prepareResponseObservers(
      'http://localhost/dss/graphql',
      queuedSettlementRequest({ method: 'POST' })
    );
    mocks.proof.mockResolvedValue(proof(false));
    const response = await observe(responseWithHint(false));
    expect(await response.json()).toHaveProperty('data.id', 'canonical');
    expect(responseAuthorityGeneration(response)).toBeUndefined();
    await expect(assertResponseAuthority(response)).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
  });

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
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
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
    mocks.proof.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
    );
    await expect(
      observe(new Response('{"data":{"id":"canonical"}}'))
    ).rejects.toThrow('Unable to verify CRM access');
  });
});
