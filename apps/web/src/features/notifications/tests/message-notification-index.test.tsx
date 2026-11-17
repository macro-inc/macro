import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { disposeChannelNotificationRefresh } from '@queries/channel/notification-refresh';
import { revalidateNotificationReaders } from '@queries/notification/revalidation';
import {
  ChannelDetailSoupDocument,
  SoupUnseenNotificationsDocument,
} from '@service-storage/graphql/generated/graphql';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import type { MessageParent } from '@service-storage/messages';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createMemo, createSignal, For, type Setter } from 'solid-js';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { MessageNotificationIndexContext } from '../components/MarkMessageNotifications';
import { MessageNotificationIndexProvider } from '../components/MessageNotificationIndexProvider';
import { indexUnreadMessageNotifications } from '../unread-message-notifications';
import {
  installMessageIntersectionObserver,
  ObservedMessage as MarkMessageNotifications,
} from './message-read-visibility';

type QueryOptions = {
  query: unknown;
  variables: { input: { initial: { filters: Record<string, unknown> } } };
  enabled: boolean;
  select: (data: unknown) => UnifiedNotification[];
};
type Edges = Record<string, UnifiedNotification[]>;

const mocks = vi.hoisted(() => ({
  source: undefined as NotificationSource | undefined,
  createQuery: vi.fn(),
  subscribe: vi.fn(
    (_listener: (patch: GraphqlNotificationPatch) => void) => () => {}
  ),
  client: { query: vi.fn() },
  cacheHost: true,
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useOptionalGlobalNotificationSource: () => mocks.source,
}));
vi.mock('@app/lib/urql-solid', () => ({ createUrqlQuery: mocks.createQuery }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  hasGraphqlCacheHost: () => mocks.cacheHost,
  mapGraphqlNotification: (n: unknown) => n,
  subscribeGraphqlSoupReconnected: () => () => {},
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: mocks.subscribe,
}));

const DOCUMENT: MessageParent = { type: 'document', id: 'document-1' };

function notification(
  id: string,
  content: { messageId?: string; commentId?: string },
  entity: Pick<UnifiedNotification, 'entity_type' | 'entity_id'> = {
    entity_type: 'document',
    entity_id: 'document-1',
  }
): UnifiedNotification {
  return {
    id,
    ...entity,
    created_at: '2026-11-16T00:00:00.000Z',
    state: 'unseen',
    notification_event_type: 'commented_on_document',
    notification_metadata: {
      tag: 'commented_on_document',
      content,
    } as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-11-16T00:00:00.000Z',
    viewed_at: null,
  };
}

function Thread(props: { parent: MessageParent; messageIds: string[] }) {
  return (
    <MessageNotificationIndexProvider parent={props.parent}>
      <For each={props.messageIds}>
        {(messageId) => (
          <MarkMessageNotifications messageId={messageId} parent={props.parent}>
            {messageId}
          </MarkMessageNotifications>
        )}
      </For>
    </MessageNotificationIndexProvider>
  );
}

const bulkMarkAsRead = vi.fn<NotificationSource['bulkMarkAsRead']>();
const notificationsByEntity = vi.fn<
  NotificationSource['notificationsByEntity']
>(() => ({}));

describe('MessageNotificationIndexProvider', () => {
  let queries: {
    options: () => QueryOptions;
    refetch: Mock<() => Promise<void>>;
  }[];
  let setEdges: Setter<Edges>;
  let intersect: ReturnType<typeof installMessageIntersectionObserver>;

  beforeEach(() => {
    // Only the registry's release timers; visibility checks poll on intervals.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    intersect = installMessageIntersectionObserver();
    bulkMarkAsRead.mockResolvedValue(undefined);
    notificationsByEntity.mockReturnValue({});
    queries = [];
    const [edges, set] = createSignal<Edges>({});
    setEdges = set;
    mocks.cacheHost = true;
    mocks.source = {
      notificationsByEntity,
      bulkMarkAsRead,
      isEnabled: () => true,
      withLocalOverrides: (n: UnifiedNotification) => n,
    } as unknown as NotificationSource;
    // The normalized cache's answer for each entity's edge, by entity id.
    mocks.createQuery.mockImplementation((options: () => QueryOptions) => {
      const refetch = vi.fn(async (): Promise<void> => {});
      queries.push({ options, refetch });
      return {
        get isEnabled() {
          return options().enabled;
        },
        isPending: false,
        isSuccess: true,
        isFetching: false,
        error: null,
        get data() {
          const items = Object.entries(edges()).map(([id, notifications]) => ({
            id,
            notifications,
          }));
          return options().select({
            user: { id: 'me', soup: { nextCursor: null, items } },
          });
        },
        refetch,
      };
    });
  });

  afterEach(() => {
    cleanup();
    // End every query its last reader released.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    disposeChannelNotificationRefresh(mocks.client as never);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("gives a thread's messages one query of its parent's unseen edge and never reads the feed", async () => {
    const rootComment = notification('root-comment', { commentId: 'root' });
    const replyMention = notification('reply-mention', { messageId: 'reply' });
    setEdges({ 'document-1': [rootComment, replyMention] });
    render(() => (
      <Thread parent={DOCUMENT} messageIds={['root', 'reply', 'quiet']} />
    ));

    expect(queries).toHaveLength(1);
    const options = queries[0].options();
    expect(options.query).toBe(SoupUnseenNotificationsDocument);
    expect(options.variables.input.initial.filters.documentFilter).toEqual({
      literal: { id: 'document-1' },
    });
    expect(options.enabled).toBe(true);

    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(2));
    expect(bulkMarkAsRead).toHaveBeenCalledWith([rootComment]);
    expect(bulkMarkAsRead).toHaveBeenCalledWith([replyMention]);
    expect(notificationsByEntity).not.toHaveBeenCalled();
  });

  it("selects the parent's own unseen rows by messageId and commentId after local read and done state", async () => {
    const locallyRead = notification('locally-read', { messageId: 'root' });
    const locallyDone = notification('locally-done', { messageId: 'root' });
    mocks.source = {
      ...mocks.source,
      withLocalOverrides: (n: UnifiedNotification) =>
        n.id === locallyRead.id
          ? { ...n, state: 'seen' }
          : n.id === locallyDone.id
            ? { ...n, state: 'done' }
            : n,
    } as NotificationSource;
    setEdges({
      'document-1': [
        notification('by-message', { messageId: 'root' }),
        notification('by-comment', { commentId: 'root' }),
        notification('other-message', { messageId: 'reply' }),
        notification(
          'references-document',
          { messageId: 'root' },
          { entity_type: 'channel', entity_id: 'channel-1' }
        ),
        {
          ...notification('cached-read', { messageId: 'root' }),
          state: 'seen',
        },
        locallyRead,
        locallyDone,
      ],
    });
    render(() => <Thread parent={DOCUMENT} messageIds={['root']} />);

    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    expect(bulkMarkAsRead.mock.calls[0][0].map(({ id }) => id)).toEqual([
      'by-message',
      'by-comment',
    ]);
  });

  it('marks a notification that arrives for a visible message, reading again on its deliveries', async () => {
    setEdges({ 'document-1': [] });
    render(() => <Thread parent={DOCUMENT} messageIds={['root']} />);
    const deliver = mocks.subscribe.mock.calls[0][0];
    const patch = (
      __typename: 'GraphqlNewNotification' | 'GraphqlUpdatedNotification',
      notification: { id: string; entityId: string; state?: string }
    ) => deliver({ __typename, notification } as GraphqlNotificationPatch);
    intersect();

    patch('GraphqlNewNotification', { id: 'elsewhere', entityId: 'other' });
    expect(queries[0].refetch).not.toHaveBeenCalled();
    patch('GraphqlNewNotification', { id: 'new', entityId: 'document-1' });
    expect(queries[0].refetch).toHaveBeenCalledExactlyOnceWith({
      requestPolicy: 'network-only',
      throwOnError: true,
    });

    const arrived = notification('new', { messageId: 'root' });
    setEdges({ 'document-1': [arrived] });
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    expect(bulkMarkAsRead).toHaveBeenCalledWith([arrived]);

    // The cache rewrites a held row's state; only a row the edge lacks needs a read.
    patch('GraphqlUpdatedNotification', {
      id: 'new',
      entityId: 'document-1',
      state: 'SEEN',
    });
    patch('GraphqlUpdatedNotification', {
      id: 'unknown',
      entityId: 'document-1',
      state: 'SEEN',
    });
    expect(queries[0].refetch).toHaveBeenCalledOnce();
    patch('GraphqlUpdatedNotification', {
      id: 'unknown',
      entityId: 'document-1',
      state: 'UNSEEN',
    });
    await waitFor(() => expect(queries[0].refetch).toHaveBeenCalledTimes(2));
  });

  it("shares one query among a parent's threads and reads a channel thread from the channel's unread edge", async () => {
    const channelReply = notification(
      'channel-reply',
      { messageId: 'reply' },
      { entity_type: 'channel', entity_id: 'channel-1' }
    );
    setEdges({ 'channel-1': [channelReply] });
    render(() => (
      <>
        <Thread parent={DOCUMENT} messageIds={['root']} />
        <Thread parent={DOCUMENT} messageIds={['other-root']} />
        <Thread
          parent={{ type: 'channel', id: 'channel-1' }}
          messageIds={['reply']}
        />
      </>
    ));

    expect(queries.map(({ options }) => options().query)).toEqual([
      SoupUnseenNotificationsDocument,
      ChannelDetailSoupDocument,
    ]);
    expect(
      queries[1].options().variables.input.initial.filters.channelFilter
    ).toEqual({ literal: { channelId: 'channel-1' } });
    intersect();
    await waitFor(() =>
      expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([channelReply])
    );
    expect(notificationsByEntity).not.toHaveBeenCalled();
  });

  it('requests and listens for nothing while the notification source is disabled', () => {
    mocks.source = {
      ...mocks.source,
      isEnabled: () => false,
    } as NotificationSource;
    setEdges({ 'document-1': [notification('unread', { messageId: 'root' })] });
    render(() => <Thread parent={DOCUMENT} messageIds={['root']} />);

    intersect();
    expect(queries.map(({ options }) => options().enabled)).toEqual([false]);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(notificationsByEntity).not.toHaveBeenCalled();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('keeps CRM contact threads on the feed, since no Soup read returns a contact', async () => {
    const contactReply = notification(
      'contact-reply',
      { messageId: 'root' },
      { entity_type: 'crm_contact', entity_id: 'contact-1' }
    );
    notificationsByEntity.mockReturnValue({
      'crm_contact@contact-1': [contactReply],
    });
    render(() => (
      <Thread
        parent={{ type: 'crm_contact', id: 'contact-1' }}
        messageIds={['root']}
      />
    ));

    intersect();
    await waitFor(() =>
      expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([contactReply])
    );
    expect(queries).toHaveLength(0);
  });

  it("leaves an enclosing view's index in place and starts no query of its own", async () => {
    const fromView = notification(
      'from-view',
      { messageId: 'reply' },
      { entity_type: 'channel', entity_id: 'channel-1' }
    );
    setEdges({ 'channel-1': [] });
    render(() => {
      const viewIndex = createMemo(() =>
        indexUnreadMessageNotifications([fromView])
      );
      return (
        <MessageNotificationIndexContext.Provider value={viewIndex}>
          <Thread
            parent={{ type: 'channel', id: 'channel-1' }}
            messageIds={['reply']}
          />
        </MessageNotificationIndexContext.Provider>
      );
    });

    intersect();
    await waitFor(() =>
      expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([fromView])
    );
    expect(queries).toHaveLength(0);
    expect(notificationsByEntity).not.toHaveBeenCalled();
  });

  it('reads again for an update to a held row only when no cache keeps it current', async () => {
    mocks.cacheHost = false;
    setEdges({ 'document-1': [notification('held', { messageId: 'root' })] });
    render(() => <Thread parent={DOCUMENT} messageIds={['root']} />);
    const deliver = mocks.subscribe.mock.calls[0][0];

    await revalidateNotificationReaders(mocks.client as never, {
      unmaintainedOnly: true,
    });
    expect(queries[0].refetch).toHaveBeenCalledOnce();
    deliver({
      __typename: 'GraphqlUpdatedNotification',
      notification: { id: 'held', entityId: 'document-1', state: 'SEEN' },
    } as GraphqlNotificationPatch);
    await waitFor(() => expect(queries[0].refetch).toHaveBeenCalledTimes(2));

    mocks.cacheHost = true;
    await revalidateNotificationReaders(mocks.client as never, {
      unmaintainedOnly: true,
    });
    deliver({
      __typename: 'GraphqlUpdatedNotification',
      notification: { id: 'held', entityId: 'document-1', state: 'SEEN' },
    } as GraphqlNotificationPatch);
    expect(queries[0].refetch).toHaveBeenCalledTimes(2);
  });
});
