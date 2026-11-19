import type { EmailEntity } from '@entity/types/entity';
import type { NotificationState } from '@service-storage/graphql/generated/graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelsUnread, createMailUnread } from './view-unread';

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  channels: vi.fn(),
  withLocalState: vi.fn(),
  notificationPreferences: vi.fn(),
  emailQuery: vi.fn(),
}));

vi.mock('@queries/channel/unread-presence', () => ({
  createChannelUnreadQuery: mocks.channels,
}));
vi.mock('@app/features/email-view/queries/email-query', () => ({
  buildEmailQuery: mocks.emailQuery,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.email,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    withLocalState: mocks.withLocalState,
  }),
}));
vi.mock('@queries/notification/type-preferences', () => ({
  useNotificationTypePreferencesQuery: mocks.notificationPreferences,
}));
// Query builders import the soup barrel, which otherwise opens real sockets.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const thread = (
  id: string,
  change: Partial<EmailEntity> = {}
): EmailEntity => ({
  id,
  type: 'email',
  name: id,
  ownerId: 'user',
  isRead: false,
  isDraft: false,
  isImportant: true,
  done: false,
  ...change,
});

const threads = (count: number) =>
  Array.from({ length: count }, (_, index) => thread(`thread-${index}`));

let dispose: VoidFunction | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllMocks();
});

function mail(options: {
  emails: EmailEntity[];
  hasNextPage?: boolean;
  exact?: boolean;
}) {
  return createRoot((disposer) => {
    dispose = disposer;
    const [emails, setEmails] = createSignal(options.emails);
    const [hasNextPage, setHasNextPage] = createSignal(
      options.hasNextPage ?? false
    );
    const [fetchingNextPage, setFetchingNextPage] = createSignal(false);
    const [nextPageFailed, setNextPageFailed] = createSignal(false);
    const [disabledTypes, setDisabledTypes] = createSignal<string[]>([]);
    const [pending, setPending] = createSignal(false);
    const fetchNextPage = vi.fn(async () => {
      setFetchingNextPage(true);
    });
    mocks.notificationPreferences.mockReturnValue({
      isPending: false,
      get data() {
        return { disabled_types: disabledTypes() };
      },
    });
    mocks.email.mockReturnValue({
      get isPending() {
        return pending();
      },
      get data() {
        if (pending()) throw new Error('Read pending resource');
        return { entities: emails() };
      },
      get hasNextPage() {
        return hasNextPage();
      },
      get isFetchingNextPage() {
        return fetchingNextPage();
      },
      get isFetchNextPageError() {
        return nextPageFailed();
      },
      fetchNextPage,
    });
    return {
      count: createMailUnread({ exact: options.exact ?? true }),
      fetchNextPage,
      setEmails,
      setHasNextPage,
      setFetchingNextPage,
      setNextPageFailed,
      setDisabledTypes,
      setPending,
    };
  });
}

describe('createMailUnread', () => {
  it("runs the Important tab's own query over every inbox, unread only", () => {
    mail({ emails: [] });
    // The query is built when the source reads its arguments.
    mocks.email.mock.calls[0][0]();
    expect(mocks.emailQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'important',
        inboxIds: undefined,
        facets: { read: ['unread'] },
      })
    );
  });

  it('counts unread threads, not messages or read and done threads', () => {
    const { count, setEmails } = mail({
      emails: [
        thread('a'),
        thread('b'),
        thread('read', { isRead: true }),
        thread('done', { done: true }),
      ],
    });
    expect(count()).toBe(2);

    // Read in another tab or on another device: the cached row follows.
    setEmails([thread('a', { isRead: true }), thread('b')]);
    expect(count()).toBe(1);
    setEmails([]);
    expect(count()).toBe(0);
  });

  it('shows nothing while the page is pending, without suspending', () => {
    const { count, setPending } = mail({ emails: [thread('a')] });
    setPending(true);
    expect(count()).toBe(0);
    setPending(false);
    expect(count()).toBe(1);
  });

  it('is past the label with a full page and more behind it, without reading on', () => {
    const { count, fetchNextPage } = mail({
      emails: threads(100),
      hasNextPage: true,
    });
    expect(count()).toBeGreaterThan(99);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('reads one more page once reads leave fewer loaded than the label shows', () => {
    const {
      count,
      fetchNextPage,
      setEmails,
      setHasNextPage,
      setFetchingNextPage,
    } = mail({ emails: threads(100), hasNextPage: true });

    setEmails(
      threads(100).map((row, index) =>
        index < 3 ? { ...row, isRead: true } : row
      )
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    // At least one more is unread until the page says how many.
    expect(count()).toBe(98);

    // The next page holds the last two unread threads.
    setEmails([...threads(100).slice(3), thread('x'), thread('y')]);
    setHasNextPage(false);
    setFetchingNextPage(false);
    expect(count()).toBe(99);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('asks for a failed page no more, and stays a lower bound', () => {
    const {
      count,
      fetchNextPage,
      setEmails,
      setFetchingNextPage,
      setNextPageFailed,
    } = mail({ emails: threads(100), hasNextPage: true });

    setEmails(threads(100).slice(5));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    setNextPageFailed(true);
    setFetchingNextPage(false);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(count()).toBe(96);

    // Once the query succeeds again, the page is asked for again.
    setNextPageFailed(false);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('reads no page past the loaded ones for a dot alone', () => {
    const { count, fetchNextPage, setEmails } = mail({
      emails: threads(3),
      hasNextPage: true,
      exact: false,
    });
    setEmails([thread('a', { isRead: true })]);
    expect(fetchNextPage).not.toHaveBeenCalled();
    // More stay behind the page, so the dot stays lit.
    expect(count()).toBe(1);
  });

  it('shows no badge while New email notifications are off', () => {
    const { count, setDisabledTypes } = mail({ emails: [thread('a')] });
    setDisabledTypes(['new_email']);
    expect(count()).toBe(0);
    setDisabledTypes(['task_assigned']);
    expect(count()).toBe(1);
  });
});

describe('createChannelsUnread', () => {
  function channels() {
    return createRoot((disposer) => {
      dispose = disposer;
      const [witnesses, setWitnesses] = createSignal<
        { id: string; state: NotificationState }[]
      >([]);
      const [seenHere, setSeenHere] = createSignal<string[]>([]);
      mocks.withLocalState.mockImplementation(({ id, state }) =>
        seenHere().includes(id) ? 'seen' : state
      );
      mocks.channels.mockReturnValue({
        isEnabled: true,
        isPending: false,
        get data() {
          return witnesses();
        },
      });
      return {
        count: createChannelsUnread(),
        setWitnesses,
        setSeenHere,
      };
    });
  }

  it('counts conversations with an unseen top-level message', () => {
    const { count, setWitnesses, setSeenHere } = channels();
    expect(count()).toBe(0);

    setWitnesses([
      { id: 'general', state: 'UNSEEN' },
      { id: 'design', state: 'UNSEEN' },
      { id: 'quiet', state: 'SEEN' },
    ]);
    expect(count()).toBe(2);

    // Opening a conversation marks it seen here before the server answers.
    setSeenHere(['general']);
    expect(count()).toBe(1);
  });

  it('reads one witness per channel, with the top-level rule', () => {
    channels();
    expect(mocks.channels.mock.calls[0][0]).toMatchObject({
      initial: {
        limit: 500,
        filters: {
          channelFilter: { literal: { notificationState: 'UNSEEN' } },
        },
      },
    });
  });
});
