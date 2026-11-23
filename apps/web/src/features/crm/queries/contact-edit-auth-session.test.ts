import { clearLocalAuthSession } from '@core/auth/logout';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { registerCacheHost } from '@graphql-cache/lifecycle';
import { beginCacheWriteSession } from '@graphql-cache/session-writes';
import { clearLocalDrafts } from '@queries/email/local-drafts';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { editContact } from './contact-edit';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const { client, soup } = vi.hoisted(() => ({
  client: { current: undefined as QueryClient | undefined },
  soup: { client: {}, host: undefined as CacheHost | undefined },
}));
vi.mock('@queries/client', () => ({
  queryPersistence: {
    clear: async () => {
      client.current?.clear();
    },
  },
  get queryClient() {
    return client.current;
  },
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn(), reset: vi.fn() }),
}));
vi.mock('@ui', () => ({ confirmDialog: vi.fn() }));
vi.mock('@queries/email/local-drafts', () => ({
  clearLocalDrafts: vi.fn(async () => {}),
  flushLocalDrafts: vi.fn(async () => {}),
  listLocalDrafts: vi.fn(async () => []),
}));
vi.mock('@queries/email/send-queue', () => ({
  readEmailSendIntents: vi.fn(async () => []),
  settledSendAttempt: () => ({ status: 'ACCEPTED' }),
}));
vi.mock('@queries/email/outbox-session', () => ({
  setEmailOutboxSession: vi.fn(),
}));
vi.mock('@core/util/cookies', () => ({ syncLoginStorage: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => soup.client,
  getGraphqlSoupCacheHost: () => soup.host,
  recordGraphqlMutationQueueCleared: vi.fn(async () => {}),
  setGraphqlSoupSessionActive: vi.fn(),
}));
vi.mock('@queries/auth/user-info', () => ({
  authKeys: {
    userInfo: { queryKey: ['auth', 'user-info'] },
    aiBillingSummary: { queryKey: ['auth', 'ai-billing-summary'] },
  },
}));
vi.mock('@queries/storage/document-cache', () => ({
  clearDocumentQueryCache: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { logout: vi.fn() },
}));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  unregisterPushRegistrationsForLogout: vi.fn(async () => {}),
}));

it('rejects a late REST completion after the cache wipe while another logout wipe is pending', async () => {
  const queryClient = new QueryClient();
  client.current = queryClient;
  await beginCacheWriteSession(async () => {}).ready;
  let wiped!: () => void;
  const cacheWiped = new Promise<void>((resolve) => {
    wiped = resolve;
  });
  const noop = createNoopCacheHost();
  const writeQuery = vi.fn(noop.writeQuery);
  const deleteRecords = vi.fn(noop.deleteRecords);
  const host = {
    ...noop,
    disabled: false,
    writeQuery,
    deleteRecords,
    clear: async () => {
      wiped();
      return createNoopCacheHost().clear();
    },
  };
  soup.host = host;
  const unregister = registerCacheHost(host);
  let releaseWipe!: () => void;
  const heldWipe = new Promise<void>((resolve) => {
    releaseWipe = resolve;
  });
  vi.mocked(clearLocalDrafts).mockImplementationOnce(() => heldWipe);
  const contact = {
    id: 'owned-contact',
    companyId: null,
    email: null,
    name: 'Example person',
    hidden: false,
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    firstInteraction: '2026-10-01',
    lastInteraction: '2026-10-01',
  };
  const saved = { ...contact, email: 'user@example.com' };
  let completeSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  const deps = {
    client: queryClient,
    storage: {},
  } as unknown as CrmRecordDependencies;
  const editing = editContact(deps, contact, 'email', async () => {
    await saving;
    return ok(saved);
  });
  const logout = clearLocalAuthSession();
  try {
    await cacheWiped;
    // GraphQL object identity is deliberately unchanged until the last wipe.
    completeSave();
    await editing;
    expect(writeQuery).not.toHaveBeenCalled();
    expect(deleteRecords).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(crmKeys.contact(contact.id).queryKey)
    ).toBeUndefined();
  } finally {
    releaseWipe();
    await logout;
    unregister();
    soup.host = undefined;
    queryClient.clear();
  }
});
