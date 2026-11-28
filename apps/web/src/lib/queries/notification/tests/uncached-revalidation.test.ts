import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock('@service-storage/graphql-soup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getGraphqlSoupClient: () => mocks.client,
  getGraphqlCacheHost: () => undefined,
  graphqlCacheEnabled: () => false,
  hasGraphqlCacheHost: () => false,
}));

import { SoupDocument } from '@service-storage/graphql/generated/graphql';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../../soup/graphql/active-queries';
import { createRevalidatingClient } from '../../soup/graphql/revalidating-client.test-helpers';
import { updateNotificationsForEntities } from '../entity-mutations';
import {
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
} from '../user-notifications';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

/** A mounted Soup list, registered for refreshes and with its pages, as
 * soup/items.ts and create-soup-live-query.ts do. */
async function mountList() {
  const server = createRevalidatingClient(() => ({
    updateNotifications: [],
    updateNotificationsForEntity: [],
  }));
  mocks.client = server.client;
  const variables = { input: { initial: { limit: 50 } } };
  const list = await server.mount(SoupDocument, variables);
  cleanup.push(() => list.unsubscribe());
  cleanup.push(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: async () => {
        await server.client
          .query(SoupDocument, variables, { requestPolicy: 'network-only' })
          .toPromise();
      },
    })
  );
  cleanup.push(
    registerGraphqlSoupRevalidations(
      () => [{ document: SoupDocument, variables }],
      () => server.client
    )
  );
  return server;
}

describe('notification writes without the normalized cache', () => {
  it.each(['MARK_SEEN', 'MARK_DONE'] as const)(
    'reads a mounted list once after an entity %s',
    async (operation) => {
      const server = await mountList();

      await updateNotificationsForEntities({
        entities: [{ type: 'channel', id: 'channel-1' }],
        operation,
      });

      // The mount, then the client's read before the write settled.
      expect(server.reads('Soup')).toBe(2);
    }
  );

  it.each([
    ['seen', useMarkNotificationsAsSeenMutation],
    ['done', useMarkNotificationsAsDoneMutation],
  ] as const)(
    'reads a mounted list once after marking notifications %s',
    async (_name, useMutation) => {
      const server = await mountList();
      const mutation = createRoot((dispose) => {
        cleanup.push(dispose);
        return useMutation();
      });

      await mutation.mutateAsync({ notificationIds: ['n1'] });

      expect(server.reads('Soup')).toBe(2);
    }
  );
});
