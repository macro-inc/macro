import { createEmailInboxSource } from '@app/features/email-compose/queries/inbox-source';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { MailAccountsQuery } from '@service-storage/graphql/generated/graphql';
import { QueryClient } from '@tanstack/solid-query';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from './keys';
import { useMailAccountsQuery } from './mail-accounts';
import { useUpdateEmailSettingsMutation } from './settings';
import { mountEmailMutation } from './tests/mutation';

const fixture = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  cacheEnabled: true,
  patchSettings: vi.fn(),
  reportError: vi.fn(),
}));
let queryClient: QueryClient;

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  graphqlCacheEnabled: () => fixture.cacheEnabled,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { patchSettings: fixture.patchSettings },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: fixture.reportError },
}));
vi.mock('../client', () => ({
  get queryClient() {
    return queryClient;
  },
}));
vi.mock('./link', async () => {
  const { useQuery } = await import('@tanstack/solid-query');
  return {
    useNonPrimaryEmailLinkIdHeader: () => (id: string) => id,
    useEmailLinksQuery: () =>
      useQuery(() => ({ queryKey: emailKeys.links.queryKey, enabled: false })),
  };
});

function accounts(signature: string, replySignature = true): MailAccountsQuery {
  return {
    user: {
      id: 'macro|self@example.com',
      emailLinks: [
        {
          id: 'inbox-1',
          macroId: 'macro|self@example.com',
          emailAddress: 'self@example.com',
          photoUrl: null,
          isPrimary: true,
          needsReauth: false,
          draftIsSignal: true,
          settings: {
            signature,
            signatureOnRepliesForwards: replySignature,
          },
        },
      ],
    },
  };
}

function setupCatalog() {
  let stored: unknown = accounts('Old signature');
  let server = accounts('Old signature');
  let offline = false;
  let persistence: Promise<void> | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (offline) throw new TypeError('offline');
    return new Response(JSON.stringify({ data: server }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  // Keep the production exchange, Solid bridge, account source, and mutation.
  // Only durable storage and the network are simulated.
  const host = {
    clientId: 'settings-test',
    onOpsAffected: () => () => {},
    onCacheGenerationChanged: () => () => {},
    claimNextMutation: async () => undefined,
    readQuery: async () => ({ kind: 'hit', data: structuredClone(stored) }),
    writeQuery: async (args) => {
      await persistence;
      stored = structuredClone(args.data);
      return {
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: false,
        affectedOps: [],
        changed: [],
        reset: false,
      };
    },
    teardown: async () => {},
  } satisfies Pick<
    CacheHost,
    | 'clientId'
    | 'onOpsAffected'
    | 'onCacheGenerationChanged'
    | 'claimNextMutation'
    | 'readQuery'
    | 'writeQuery'
    | 'teardown'
  >;
  const newClient = () => {
    fixture.client = createClient({
      url: 'http://settings.test/graphql',
      exchanges: [
        normalizedCacheExchange(host as unknown as CacheHost),
        fetchExchange,
      ],
      fetch,
      preferGetMethod: false,
    });
  };
  newClient();
  return {
    fetch,
    stored: () => stored,
    setServer: (data: MailAccountsQuery) => {
      server = data;
    },
    delayPersistence: (pending: Promise<void>) => {
      persistence = pending;
    },
    goOffline: () => {
      offline = true;
    },
    newClient,
  };
}

function mountComposerAccounts() {
  return mountEmailMutation(
    () => ({
      inboxes: createEmailInboxSource(
        () => 'self@example.com',
        useMailAccountsQuery(),
        () => undefined
      ),
      update: useUpdateEmailSettingsMutation(),
    }),
    queryClient
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.cacheEnabled = true;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(emailKeys.links.queryKey, {
    links: [
      {
        id: 'inbox-1',
        settings: {
          signature: 'Old signature',
          signature_on_replies_forwards: true,
        },
      },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('email settings account reconciliation', () => {
  it('updates a mounted composer and persists canonical settings for offline reopening', async () => {
    const catalog = setupCatalog();
    const composer = mountComposerAccounts();
    await vi.waitFor(() => expect(catalog.fetch).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(composer.inboxes.inboxes()[0]?.settings.signature).toBe(
        'Old signature'
      )
    );
    const canonical = '<p>Sanitized signature</p>';
    catalog.setServer(accounts(canonical, false));
    fixture.patchSettings.mockResolvedValue(
      ok({
        settings: {
          signature: canonical,
          signature_on_replies_forwards: false,
        },
      })
    );
    const persistence = Promise.withResolvers<void>();
    catalog.delayPersistence(persistence.promise);
    let completed = false;
    async function saveSettings() {
      await composer.update.mutateAsync({
        linkId: 'inbox-1',
        settings: {
          signature: '<p>Edited signature</p>',
          signature_on_replies_forwards: false,
        },
      });
      completed = true;
    }
    const save = saveSettings();
    await vi.waitFor(() =>
      expect(composer.inboxes.inboxes()[0]?.settings).toEqual({
        signature: canonical,
        signature_on_replies_forwards: false,
      })
    );
    expect(completed).toBe(false);
    persistence.resolve();
    await save;
    expect(catalog.stored()).toMatchObject(accounts(canonical, false));
    expect(fixture.patchSettings).toHaveBeenCalledWith(
      {
        settings: {
          signature: '<p>Edited signature</p>',
          signature_on_replies_forwards: false,
        },
      },
      'inbox-1'
    );

    catalog.goOffline();
    catalog.newClient();
    queryClient.removeQueries({ queryKey: emailKeys.links.queryKey });
    const reopened = mountComposerAccounts();
    await vi.waitFor(() =>
      expect(reopened.inboxes.inboxes()[0]?.settings).toEqual({
        signature: canonical,
        signature_on_replies_forwards: false,
      })
    );
  });

  it('keeps a committed settings save successful when GraphQL refresh fails', async () => {
    const catalog = setupCatalog();
    const composer = mountComposerAccounts();
    await vi.waitFor(() => expect(catalog.fetch).toHaveBeenCalledOnce());
    catalog.goOffline();
    const response = { settings: { signature: 'Saved signature' } };
    fixture.patchSettings.mockResolvedValue(ok(response));
    await expect(
      composer.update.mutateAsync({
        linkId: 'inbox-1',
        settings: response.settings,
      })
    ).resolves.toEqual(response);
    expect(fixture.reportError).toHaveBeenCalledOnce();
    expect(fixture.patchSettings).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(emailKeys.links.queryKey)).toMatchObject({
      links: [{ id: 'inbox-1', settings: { signature: 'Saved signature' } }],
    });
  });
});
