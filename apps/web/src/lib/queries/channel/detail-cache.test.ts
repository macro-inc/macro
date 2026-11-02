import { createChannelDetail } from '@app/features/channels-view/primitives/create-channel-detail';
import { createChannelDetailSource } from '@app/features/channels-view/queries/channel-detail-source';
import { createChannelListUpdatesHandler } from '@service-storage/graphql-channel-list-updates';
import { type Client, CombinedError, type RequestPolicy } from '@urql/core';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelDetailQuery } from './detail';
import { disposeChannelNotificationRefresh } from './notification-refresh';
import {
  channelPage,
  createDetailCacheFixture,
} from './tests/detail-cache-fixture';

let client: () => Client;
let transport: ReturnType<typeof createDetailCacheFixture>;
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client(),
  mapGraphqlSoupPage: (data: ReturnType<typeof channelPage>) => ({
    items: data.user.soup.items,
  }),
}));
// Mapping is a transport boundary; all cache, query, source, and view-state
// transitions below run their production implementations.
vi.mock('../soup/transform-utils', () => ({
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

it('does not replace an admitted conversation with a lagging empty cache projection', async () => {
  const { detail, states } = setup();
  const first = await transport.requests.next();
  first.respond(channelPage('one'));
  await transport.results.next();
  expect(detail.view().status).toBe('ready');
  states.length = 0;
  await transport.cache(channelPage());
  expect(detail.view().status).toBe('ready');
  expect(states).not.toContain('unavailable');
  const confirmation = await transport.requests.next();
  confirmation.respond(channelPage('one'));
  await transport.results.next();
  const count = transport.networkCount();
  await transport.cache(channelPage());
  expect(detail.view().status).toBe('ready');
  expect(transport.networkCount()).toBe(count);
});

it('keeps a server-confirmed absence hidden through positive cache updates until a fresh grant', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  expect(detail.view().status).toBe('unavailable');
  await transport.cache(channelPage('one'));
  expect(detail.view().status).toBe('unavailable');
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  expect(detail.view().status).toBe('ready');
});

it('honors fresh access denial and does not let cached records restore access', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  const refresh = expect(detail.refresh()).rejects.toThrow();
  (await transport.requests.next()).respond(
    undefined,
    new CombinedError({ graphQLErrors: ['Forbidden'] })
  );
  await refresh;
  expect(detail.view().status).toBe('unavailable');
  await transport.cache(channelPage('one'));
  expect(detail.view().status).toBe('unavailable');
});

it('does not reuse one channel’s membership decision for another', async () => {
  const { detail, setId } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  setId('two');
  expect(detail.view().status).toBe('loading');
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  expect(detail.view().status).toBe('unavailable');
});

it('confirms a cache disappearance and hides a fresh server deletion', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  await transport.cache(channelPage());
  expect(detail.view().status).toBe('ready');
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  expect(detail.view().status).toBe('unavailable');
});

it.each(['reconnect', 'invite'] as const)(
  'recovers a denied route on %s before its message view mounts',
  async (event) => {
    const { detail } = setup();
    (await transport.requests.next()).respond(channelPage());
    await transport.results.next();
    expect(detail.view().status).toBe('unavailable');
    const updates = createChannelListUpdatesHandler(transport.client);
    disposers.push(updates.dispose);
    if (event === 'reconnect') updates.reconnect();
    else
      await updates.onPatch({
        __typename: 'GraphqlNewNotification',
        notification: {
          __typename: 'GraphqlNotification',
          id: 'invite',
          entityId: 'one',
          entityType: 'CHANNEL',
          targetEntityType: 'CHANNEL',
          eventType: 'channel_invite',
          state: 'UNSEEN',
          sent: true,
          senderId: 'sender',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          viewedAt: null,
          metadata: {
            __typename: 'GraphqlChannelInviteMetadata',
            channelInviteChannelName: 'Conversation',
            channelInviteMessageContent: null,
            channelInviteSenderProfilePictureUrl: null,
            channelInviteInvitedBy: 'sender',
          },
        },
      });
    (await transport.requests.next()).respond(channelPage('one'));
    await transport.results.next();
    expect(detail.view().status).toBe('ready');
  }
);

it('keeps an admitted conversation through a transport failure and later cache updates', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  const refreshed = expect(detail.refresh()).rejects.toThrow();
  (await transport.requests.next()).respond(
    undefined,
    new CombinedError({ networkError: new Error('Offline') })
  );
  await refreshed;
  expect(detail.view().status).toBe('ready');
  await transport.cache(channelPage());
  expect(detail.view().status).toBe('ready');
});

it('confirms a cold cache-only absence before declaring the channel unavailable', async () => {
  const { detail } = setup({
    requestPolicy: 'cache-first',
    cached: channelPage(),
  });
  const request = await transport.requests.next();
  expect(detail.view().status).toBe('loading');
  request.respond(channelPage('one'));
  // The first result is the empty cache hit, followed by network confirmation.
  await transport.results.next();
  await transport.results.next();
  expect(detail.view().status).toBe('ready');
});

it('keeps cache-first display readers local when a channel is cached', async () => {
  const { detail } = setup({
    requestPolicy: 'cache-first',
    cached: channelPage('one'),
  });
  await transport.results.next();
  expect(detail.view().status).toBe('ready');
  expect(transport.networkCount()).toBe(0);
});

it('rechecks the same positive cache hint after disabling and reopening a denied reader', async () => {
  const { detail, setEnabled } = setup({ requestPolicy: 'cache-first' });
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  await transport.cache(channelPage('one'));
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  const count = transport.networkCount();
  await transport.cache(channelPage('one'));
  expect(transport.networkCount()).toBe(count);
  expect(detail.view().status).toBe('unavailable');
  setEnabled(false);
  setEnabled(true);
  const request = await transport.requests.next();
  transport.results.clear();
  request.respond(channelPage('one'));
  await transport.results.next();
  expect(detail.view().status).toBe('ready');
});

it('does not retain a previous client’s denial after account replacement', async () => {
  const { detail, setClient } = setup();
  (await transport.requests.next()).respond(channelPage());
  await transport.results.next();
  const replacement = createDetailCacheFixture();
  disposers.push(() => disposeChannelNotificationRefresh(replacement.client));
  setClient(() => replacement.client);
  (await replacement.requests.next()).respond(channelPage('one'));
  await replacement.results.next();
  expect(detail.view().status).toBe('ready');
});

it('keeps admitted channel fields live without refetching unchanged membership', async () => {
  const { detail } = setup();
  (await transport.requests.next()).respond(channelPage('one'));
  await transport.results.next();
  const count = transport.networkCount();
  await transport.cache(channelPage('one', 'Renamed conversation'));
  const view = detail.view();
  expect(view.status).toBe('ready');
  expect(view.status === 'ready' && view.channel.name).toBe(
    'Renamed conversation'
  );
  expect(transport.networkCount()).toBe(count);
});
