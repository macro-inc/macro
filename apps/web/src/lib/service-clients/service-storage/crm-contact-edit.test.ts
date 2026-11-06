import { externalWriteVersion } from '@graphql-cache/exchange/external-writes';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { createTauriCacheHost } from '@graphql-cache/host/tauri-host';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  clearRegisteredCaches,
  registerCacheHost,
  replaceCacheWriteSession,
} from '@graphql-cache/lifecycle';
import { beginCacheWriteSession } from '@graphql-cache/session-writes';
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareCrmContactEdit } from './crm-contact-edit';

const mocks = vi.hoisted(() => ({
  client: {},
  nativeHost: undefined as CacheHost | undefined,
  invoke: vi.fn(),
  host: { writeQuery: vi.fn(), deleteRecords: vi.fn() },
  error: vi.fn(),
}));
vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  getGraphqlSoupCacheHost: () => mocks.nativeHost ?? mocks.host,
}));
vi.mock('@macro-inc/observability', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@macro-inc/observability')>();
  vi.spyOn(original.Telemetry, 'error').mockImplementation(mocks.error);
  return original;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
beforeEach(async () => {
  await clearRegisteredCaches();
  await beginCacheWriteSession(async () => {}).ready;
  mocks.nativeHost = undefined;
  mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.client = {};
  mocks.host = {
    writeQuery: vi.fn(async () => undefined),
    deleteRecords: vi.fn(async () => undefined),
  };
  mocks.error.mockClear();
});
const contact = {
  id: 'contact-1',
  companyId: null,
  email: null,
  name: 'Example person',
  hidden: true,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-02',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};

it('publishes explicit clears through the normalized document and fences older reads', async () => {
  const host = mocks.host as unknown as CacheHost;
  const before = externalWriteVersion(host);
  await prepareCrmContactEdit().commit(contact, null);
  expect(externalWriteVersion(host)).toBeGreaterThan(before);
  expect(mocks.host.writeQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      operationName: 'CrmContactCacheWrite',
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupCrmContact',
              id: contact.id,
              parentCompanyId: null,
              parentCompanyName: null,
              emailAddress: null,

              updatedAt: contact.updatedAt,
            },
          },
        ],
      },
    })
  );
});
it('rejects writes after the session changed', async () => {
  const writer = prepareCrmContactEdit();
  mocks.client = {};
  expect(writer.isCurrent()).toBe(false);
  await writer.commit(contact, null);
  expect(mocks.host.writeQuery).not.toHaveBeenCalled();
});
it('repairs only the affected contact on cache failure without reporting a committed save as failed', async () => {
  mocks.host.writeQuery.mockRejectedValueOnce(new Error('worker unavailable'));
  await expect(
    prepareCrmContactEdit().commit(contact, null)
  ).resolves.toBeUndefined();
  expect(mocks.host.deleteRecords).toHaveBeenCalledWith([
    'GraphqlSoupCrmContact:contact-1',
  ]);
});

it('fences and invalidates an uncertain contact without crossing a replaced session', async () => {
  const writer = prepareCrmContactEdit();
  const host = mocks.host as unknown as CacheHost;
  const before = externalWriteVersion(host);
  await writer.invalidate(contact.id);
  expect(externalWriteVersion(host)).toBeGreaterThan(before);
  expect(mocks.host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
    'GraphqlSoupCrmContact:contact-1',
  ]);
  mocks.client = {};
  await writer.invalidate('contact-2');
  expect(mocks.host.deleteRecords).toHaveBeenCalledTimes(1);
});

it.each(['write', 'delete', 'repair'] as const)(
  'drains an admitted native %s before wiping durable storage',
  async (operation) => {
    const host = createTauriCacheHost({ scope: 'contact-test' });
    mocks.nativeHost = host;
    const unregister = registerCacheHost(host);
    await host.readQuery({ query: '{ warm }' });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const admitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let stored = 'old-contact';
    const clear = vi.fn(() => {
      stored = '';
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'graphql_cache_write' && operation === 'repair') {
        throw new Error('write failed');
      }
      const mutation =
        operation === 'write'
          ? 'graphql_cache_write'
          : 'graphql_cache_delete_records';
      if (command === mutation) {
        started();
        await held;
        stored = operation === 'write' ? 'late-contact' : '';
      }
      if (command === 'graphql_cache_clear') {
        clear();
        return '0';
      }
      return {
        revision: '0',
        revisionAdvanced: false,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    });
    const writer = prepareCrmContactEdit();
    const writing =
      operation === 'delete'
        ? writer.invalidate(contact.id)
        : writer.commit(contact, null);
    await admitted;
    const clearing = clearRegisteredCaches();
    try {
      // Real Tauri host dispatch gives clear an opportunity to reach IPC while
      // the earlier mutation is deliberately held outside the native engine.
      await host.readQuery({ query: '{ checkpoint }' });
      expect(writer.isCurrent()).toBe(false);
      expect(clear).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all([writing, clearing]);
      unregister();
      host.dispose();
    }
    expect(clear).toHaveBeenCalledOnce();
    expect(stored).toBe('');
  }
);

it('does not admit failure repair after logout closes the session', async () => {
  let reject!: (error: Error) => void;
  let started!: () => void;
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  mocks.host.writeQuery.mockImplementationOnce(() => {
    started();
    return new Promise<undefined>((_resolve, fail) => {
      reject = fail;
    });
  });
  const writing = prepareCrmContactEdit().commit(contact, null);
  await admitted;
  const clearing = clearRegisteredCaches();
  reject(new Error('native write failed'));
  await Promise.all([writing, clearing]);
  expect(mocks.host.deleteRecords).not.toHaveBeenCalled();
});

it('does not retain cleanup obligations for a disabled storage-free host', async () => {
  mocks.nativeHost = createNoopCacheHost();
  const writer = prepareCrmContactEdit();
  await writer.commit(contact, null);
  await writer.invalidate(contact.id);
  const replacement = replaceCacheWriteSession();
  await replacement.ready;
  expect(replacement.isCurrent()).toBe(true);
});
