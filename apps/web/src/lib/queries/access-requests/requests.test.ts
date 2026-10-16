import { type Client, createClient } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerActivityRevalidator } from '../activity/push-registry';
import { registerActiveGraphqlPreviewQuery } from '../preview/active-queries';
import { registerActiveGraphqlSoupQuery } from '../soup/graphql/active-queries';
import { databasesKeys } from '../storage/keys';
import { refreshSharedAccess } from './requests';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async (_filters: unknown) => {}),
  lists: vi.fn(),
}));
let client: Client;
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('@service-storage/access-requests', () => ({
  accessRequestsClient: {},
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
}));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: mocks.lists }));
const disposers: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  client = createClient({
    url: 'http://example.invalid/graphql',
    exchanges: [],
  });
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

it('refreshes mounted lists for newly visible documents and removes revoked rows and previews', () => {
  let granted = false;
  const rows: string[] = [];
  let preview = 'Private document';
  disposers.push(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: async () => {
        rows.splice(0, rows.length, ...(granted ? ['document'] : []));
      },
    })
  );
  disposers.push(
    registerActiveGraphqlPreviewQuery({
      isEnabled: () => true,
      itemId: () => 'document',
      refresh: async () => {
        preview = granted ? 'Private document' : 'No access';
      },
    })
  );
  const activity = vi.fn<
    (entities: ReadonlySet<string> | null) => Promise<void>
  >(async () => {});
  disposers.push(
    registerActivityRevalidator({ client: () => client, refresh: activity })
  );

  granted = true;
  refreshSharedAccess({ entityType: 'document', entityId: 'document' });
  expect(rows).toEqual(['document']);
  expect(mocks.lists).toHaveBeenCalledOnce();
  expect(activity).toHaveBeenLastCalledWith(new Set(['document']));
  granted = false;
  refreshSharedAccess({ entityType: 'document', entityId: 'document' });
  expect(rows).toEqual([]);
  expect(preview).toBe('No access');
  expect(mocks.lists).toHaveBeenCalledTimes(2);
});

it('refreshes folder descendants and the database discovery list after sharing changes', () => {
  const preview = vi.fn(async () => {});
  const activity = vi.fn<
    (entities: ReadonlySet<string> | null) => Promise<void>
  >(async () => {});
  disposers.push(
    registerActiveGraphqlPreviewQuery({
      isEnabled: () => true,
      itemId: () => 'child',
      refresh: preview,
    })
  );
  disposers.push(
    registerActivityRevalidator({ client: () => client, refresh: activity })
  );
  refreshSharedAccess({ entityType: 'project', entityId: 'folder' });
  expect(preview).toHaveBeenCalledOnce();
  expect(activity).toHaveBeenCalledWith(null);
  refreshSharedAccess({ entityType: 'database', entityId: 'database' });
  expect(mocks.invalidate).toHaveBeenCalledWith({
    queryKey: databasesKeys.list.queryKey,
  });
  expect(mocks.invalidate).toHaveBeenCalledWith({
    queryKey: databasesKeys.detail('database').queryKey,
  });
});
