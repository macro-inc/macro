import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { queryClient } from '@queries/client';
import type { ContactsQuery } from '@service-storage/graphql/generated/graphql';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createClient, fetchExchange } from '@urql/core';
import { ok } from 'neverthrow';
import { createEffect, createRoot, createSignal, untrack } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchContacts,
  invalidateContacts,
  useContacts,
  useContactsQuery,
} from './contacts';
import { fetchGraphqlContacts } from './graphql';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  host: vi.fn(),
  flag: (): boolean => true,
  authenticated: (): boolean => true,
  flagLoading: (): boolean => false,
  rest: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
  getGraphqlSoupCacheHost: mocks.host,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.flag(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: mocks.flag(),
    loading: mocks.flagLoading(),
  }),
}));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => mocks.authenticated(),
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id.split('|')[1],
  idToDisplayName: () => 'Contact',
}));
vi.mock('@service-contacts/client', () => ({
  contactsClient: { getContacts: mocks.rest },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const VIEWER = 'macro|user@example.com';
const CONTACT = 'macro|contact@example.com';
let dispose: (() => void) | undefined;

function mount<T>(factory: () => T): T {
  let value!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {(() => {
          value = untrack(factory);
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return value;
}

function setup(viewer = VIEWER, cached = true) {
  let stored: unknown;
  let server: ContactsQuery = {
    user: { id: viewer, contacts: [viewer, CONTACT] },
  };
  let offline = false;
  let persist = () => Promise.resolve();
  const write = vi.fn<CacheHost['writeQuery']>(async ({ data }) => {
    await persist();
    stored = data;
    return {
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: false,
      changed: [],
      affectedOps: [],
      reset: false,
    };
  });
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () =>
      stored ? { kind: 'hit', data: stored } : { kind: 'miss' },
    writeQuery: write,
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (offline) throw new Error('offline');
    return new Response(JSON.stringify({ data: server }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  const client = () =>
    createClient({
      url: 'https://contacts.invalid/graphql',
      fetch,
      exchanges: [
        ...(cached
          ? [normalizedCacheExchange(host, { extractIdentity: () => viewer })]
          : []),
        fetchExchange,
      ],
    });
  mocks.client.mockReturnValue(client());
  mocks.host.mockReturnValue(cached ? host : undefined);
  return {
    write,
    fetch,
    reopen() {
      mocks.client.mockReturnValue(client());
    },
    offline() {
      offline = true;
    },
    server(contacts: string[]) {
      server = { user: { id: viewer, contacts } };
    },
    persistence(wait: () => Promise<void>) {
      persist = wait;
    },
  };
}

describe('normal GraphQL contacts', () => {
  beforeEach(() => {
    mocks.flag = () => true;
    mocks.authenticated = () => true;
    mocks.flagLoading = () => false;
    mocks.rest.mockReset();
    mocks.rest.mockResolvedValue(ok({ contacts: [VIEWER] }));
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    queryClient.clear();
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('refreshes persisted contacts with no mounted picker and reads them after an offline reopen', async () => {
    const s = setup();
    await invalidateContacts();
    expect(s.write).toHaveBeenCalledWith(
      expect.objectContaining({ identity: VIEWER })
    );
    s.server([VIEWER]);
    await invalidateContacts();
    s.offline();
    s.reopen();
    expect(await fetchContacts()).toEqual({ contacts: [VIEWER] });
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it('reads the persisted catalog without a network request for cache-only SQL reads', async () => {
    const s = setup();
    await invalidateContacts();
    s.offline();
    expect(await fetchContacts('cache-only')).toEqual({
      contacts: [VIEWER, CONTACT],
    });
    expect(s.fetch).toHaveBeenCalledOnce();
  });

  it('answers cache-only SQL reads without waiting for a mounted network refresh', async () => {
    const s = setup();
    await invalidateContacts();
    const started = Promise.withResolvers<void>();
    const network = Promise.withResolvers<Response>();
    s.fetch.mockImplementationOnce(async () => {
      started.resolve();
      return network.promise;
    });
    mount(() => useContactsQuery());
    await started.promise;
    const cleanup = dispose;
    dispose = () => {
      network.resolve(
        new Response(
          JSON.stringify({
            data: { user: { id: VIEWER, contacts: [VIEWER] } },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      cleanup?.();
    };
    expect(await fetchContacts('cache-only')).toEqual({
      contacts: [VIEWER, CONTACT],
    });
  });

  it('rejects cache-only reads promptly when the normalized cache becomes unavailable', async () => {
    const s = setup(VIEWER, false);
    await expect(fetchContacts('cache-only')).rejects.toThrow(
      'Contacts cache unavailable'
    );
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('follows an invalidation received during a refresh with a fresh membership read', async () => {
    const s = setup();
    const started = Promise.withResolvers<void>();
    const first = Promise.withResolvers<Response>();
    s.fetch.mockImplementationOnce(async () => {
      started.resolve();
      return first.promise;
    });
    const leading = invalidateContacts();
    await started.promise;
    s.server([VIEWER]);
    const trailing = invalidateContacts();
    first.resolve(
      new Response(
        JSON.stringify({
          data: { user: { id: VIEWER, contacts: [VIEWER, CONTACT] } },
        }),
        {
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    await Promise.all([leading, trailing]);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(await fetchContacts()).toEqual({ contacts: [VIEWER] });
  });

  it.each([false, true])(
    'does not lose an invalidation during startup hydration (cache=%s)',
    async (cached) => {
      const s = setup(VIEWER, cached);
      const started = Promise.withResolvers<void>();
      const initial = Promise.withResolvers<Response>();
      s.fetch.mockImplementationOnce(async () => {
        started.resolve();
        return initial.promise;
      });
      const state = mount(() => useContactsQuery());
      await started.promise;
      s.server([VIEWER]);
      const refreshing = invalidateContacts();
      initial.resolve(
        new Response(
          JSON.stringify({
            data: { user: { id: VIEWER, contacts: [VIEWER, CONTACT] } },
          }),
          {
            headers: { 'content-type': 'application/json' },
          }
        )
      );
      await refreshing;
      expect(state.data?.contacts).toEqual([VIEWER]);
      expect(s.fetch).toHaveBeenCalledTimes(2);
    }
  );

  it('updates mounted contacts when invalidation changes catalog membership', async () => {
    const s = setup();
    const state = mount(() => useContactsQuery());
    await stateReady(state);
    expect(state.data?.contacts).toEqual([VIEWER, CONTACT]);
    s.server([VIEWER]);
    await invalidateContacts();
    expect(state.data?.contacts).toEqual([VIEWER]);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not report hydration complete until the catalog persists', async () => {
    const s = setup();
    const persistence = Promise.withResolvers<void>();
    const writing = Promise.withResolvers<void>();
    s.persistence(() => {
      writing.resolve();
      return persistence.promise;
    });
    let settled = false;
    const read = (async () => {
      await fetchGraphqlContacts('network-only');
      settled = true;
    })();
    await writing.promise;
    expect(settled).toBe(false);
    persistence.resolve();
    await read;
    expect(settled).toBe(true);
  });

  it('does not expose a partial GraphQL failure as a successfully loaded catalog without the cache exchange', async () => {
    mocks.client.mockReturnValue(
      createClient({
        url: 'https://contacts.invalid/graphql',
        exchanges: [fetchExchange],
        fetch: async () =>
          new Response(
            JSON.stringify({
              data: { user: { id: VIEWER } },
              errors: [{ message: 'Contacts are unavailable' }],
            }),
            { headers: { 'content-type': 'application/json' } }
          ),
      })
    );
    const failed = Promise.withResolvers<void>();
    const state = mount(() => {
      const query = useContactsQuery();
      createEffect(() => {
        if (query.isError) failed.resolve();
      });
      return query;
    });
    await failed.promise;
    expect(state.data).toBeUndefined();
    expect(state.isSuccess).toBe(false);
  });

  it('keeps cached contacts visible after a background offline failure', async () => {
    const s = setup();
    await invalidateContacts();
    s.offline();
    const result = Promise.withResolvers<void>();
    // Cache-and-network first publishes disk, then a failed network refresh.
    s.fetch.mockImplementationOnce(async () => {
      result.resolve();
      throw new Error('offline');
    });
    const state = mount(() => ({
      query: useContactsQuery(),
      contacts: useContacts(),
    }));
    await result.promise;
    await Promise.resolve();
    expect(state.query.data).toEqual({ contacts: [VIEWER, CONTACT] });
    expect(state.query.isError).toBe(false);
    expect(state.contacts().map((contact) => contact.id)).toEqual([
      VIEWER,
      CONTACT,
    ]);
  });

  it('reacts to auth, enabled, and transport changes without exposing disabled data', async () => {
    setup();
    await invalidateContacts();
    const [authenticated, setAuthenticated] = createSignal(true);
    const [graphql, setGraphql] = createSignal(true);
    const [enabled, setEnabled] = createSignal(true);
    mocks.authenticated = authenticated;
    mocks.flag = graphql;
    const state = mount(() => useContactsQuery(enabled));
    await stateReady(state);
    expect(state.data?.contacts).toEqual([VIEWER, CONTACT]);
    setEnabled(false);
    expect(state.data).toBeUndefined();
    setEnabled(true);
    setAuthenticated(false);
    expect(state.data).toBeUndefined();
    setGraphql(false);
    expect(mocks.rest).not.toHaveBeenCalled();
    setAuthenticated(true);
    await stateReady(state);
    expect(mocks.rest).toHaveBeenCalledOnce();
    expect(state.data?.contacts).toEqual([VIEWER]);
  });

  it('waits for remote flags and starts GraphQL without fetching the REST catalog on cold startup', async () => {
    const s = setup();
    const [flag, setFlag] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    mocks.flag = flag;
    mocks.flagLoading = loading;
    const state = mount(() => useContactsQuery());
    expect(s.fetch).not.toHaveBeenCalled();
    expect(mocks.rest).not.toHaveBeenCalled();
    setFlag(true);
    setLoading(false);
    await stateReady(state);
    expect(s.fetch).toHaveBeenCalledOnce();
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it('starts a fresh catalog after replacing the account client', async () => {
    setup();
    const [authenticated, setAuthenticated] = createSignal(true);
    mocks.authenticated = authenticated;
    const state = mount(() => useContactsQuery());
    await stateReady(state);
    expect(state.data?.contacts).toContain(CONTACT);
    setAuthenticated(false);
    // The new account has a different client and cache host, as on logout/login.
    const second = setup('macro|second@example.com');
    second.server(['macro|second@example.com']);
    setAuthenticated(true);
    expect(state.data).toBeUndefined();
    await stateReady(state);
    expect(state.data?.contacts).toEqual(['macro|second@example.com']);
    expect(second.fetch).toHaveBeenCalledOnce();
  });
});

async function stateReady(query: ReturnType<typeof useContactsQuery>) {
  await new Promise<void>((resolve) => {
    createRoot((dispose) => {
      createEffect(() => {
        if (!query.isSuccess) return;
        dispose();
        resolve();
      });
    });
  });
}
