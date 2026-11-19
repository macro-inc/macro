import { createChannelDetail } from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/features/channels-view/primitives/create-channel-detail';
import { createChannelDetailSource } from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/features/channels-view/queries/channel-detail-source';
import { createChannelListUpdatesHandler } from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/service-clients/service-storage/graphql-channel-list-updates';
import { type Client, CombinedError, type RequestPolicy } from '@urql/core';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelDetailQuery } from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/queries/channel/detail';
import { disposeChannelNotificationRefresh } from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/queries/channel/notification-refresh';
import {
  channelPage,
  createDetailCacheFixture,
} from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/queries/channel/tests/detail-cache-fixture';

let client: () => Client;
let transport: ReturnType<typeof createDetailCacheFixture>;
vi.mock('/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/service-clients/service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client(),
  mapGraphqlSoupPage: (data: ReturnType<typeof channelPage>) => ({
    items: data.user.soup.items,
  }),
}));
// Mapping is a transport boundary; all cache, query, source, and view-state
// transitions below run their production implementations.
vi.mock('/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/queries/soup/transform-utils', () => ({
  mapApiSoupItemToEntity: (item: { id: string; name: string }) => ({
    ...item,
    type: 'channel',
    ownerId: 'viewer',
    channelType: 'private',
  }),
}));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});
function setup(
  options: {
    requestPolicy?: RequestPolicy;
    cached?: ReturnType<typeof channelPage>;
  } = {}
) {
  transport = createDetailCacheFixture();
  if (options.cached) transport.seed(options.cached);
  disposers.push(() => disposeChannelNotificationRefresh(transport.client));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [id, setId] = createSignal('one');
    const [currentClient, setClient] = createSignal(transport.client);
    client = currentClient;
    const [enabled, setEnabled] = createSignal(true);
    const source = createChannelDetailSource({
      channelId: id,
      cached: () => undefined,
      createQuery: (id, active) =>
        createChannelDetailQuery(
          id,
          () => enabled() && active(),
          options.requestPolicy
        ),
    });
    const detail = createChannelDetail({
      selection: () => ({ id: id() }),
      cached: () => undefined,
      source,
      markRead: () => {},
    });
    const states: string[] = [];
    createEffect(() => states.push(detail.view().status));
    return { detail, states, setId, setClient, setEnabled };
  });
}


it('A: confirmed absence, stale positive cache, then no-response confirmation', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  expect(detail.view().status).toBe('unavailable');
  await transport.cache(channelPage('one'));
  expect(detail.view().status).toBe('unavailable');
  (await transport.requests.next()).respond(undefined, new CombinedError({ networkError: new Error('Offline') }));
  await transport.results.next();
  await new Promise((r) => setTimeout(r, 20));
  expect(detail.view().status).toBe('unavailable');
});
it('B: forbidden, cached rows, then retry gets no response', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  const refresh = expect(detail.refresh()).rejects.toThrow();
  (await transport.requests.next()).respond(undefined, new CombinedError({ graphQLErrors: ['Forbidden'] }));
  await refresh;
  expect(detail.view().status).toBe('unavailable');
  await transport.cache(channelPage('one'));
  const next = await Promise.race([transport.requests.next(), new Promise((r) => setTimeout(() => r(undefined), 300))]);
  if (next) {
    (next as any).respond(undefined, new CombinedError({ networkError: new Error('Offline') }));
    await transport.results.next();
  } else {
    const again = detail.refresh().catch(() => {});
    (await transport.requests.next()).respond(undefined, new CombinedError({ networkError: new Error('Offline') }));
    await again;
  }
  console.log('B auto-confirmation issued:', !!next);
  await new Promise((r) => setTimeout(r, 20));
  expect(detail.view().status).toBe('unavailable');
});
