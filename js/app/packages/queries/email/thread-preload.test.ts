import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchInfiniteQuery: vi.fn(),
  getQueryData: vi.fn(),
  getThreadPreload: vi.fn(),
  prefetchInfiniteQuery: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock('../client', () => ({
  queryClient: {
    fetchInfiniteQuery: mocks.fetchInfiniteQuery,
    getQueryData: mocks.getQueryData,
    prefetchInfiniteQuery: mocks.prefetchInfiniteQuery,
    setQueryData: mocks.setQueryData,
  },
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlEmailThreadPreload: mocks.getThreadPreload,
}));

vi.mock('@service-email/client', () => ({
  emailClient: { getThread: vi.fn() },
}));

vi.mock('../soup/cache', () => ({
  optimisticUpdateSoupEntity: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));

vi.mock('../soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));

vi.mock('@app/component/analytics-context', () => ({
  useAnalytics: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: vi.fn(),
}));

import { fetchAndCacheThread } from './thread';

const preload = {
  thread: {
    id: 'thread-1',
    inboxVisible: true,
    isRead: false,
    projectId: null,
    providerId: 'provider-thread',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  attachments: [],
  message: {
    id: 'message-1',
    threadId: 'thread-1',
    linkId: 'link-1',
    accessLevel: 'owner',
    subject: 'Subject',
    snippet: 'Snippet',
    internalDateTs: '2026-01-02T00:00:00Z',
    sentAt: '2026-01-02T00:00:00Z',
    isRead: false,
    isStarred: true,
    isSent: false,
    hasAttachments: false,
    from: { email: 'from@example.com', name: 'From', photoUrl: null },
    to: [{ email: 'to@example.com', name: null, photoUrl: null }],
    cc: [],
    bcc: [],
    labels: [
      {
        id: 'label-1',
        linkId: 'link-1',
        providerLabelId: 'UNREAD',
        name: 'UNREAD',
        createdAt: '2026-01-01T00:00:00Z',
        messageListVisibility: 'Show',
        labelListVisibility: 'LabelShowIfUnread',
        type: 'System',
      },
    ],
    bodyText: 'Hello',
    bodyHtmlSanitized: null,
    bodyReplyless: 'Hello',
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
};

describe('fetchAndCacheThread GraphQL preload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefetchInfiniteQuery.mockResolvedValue(undefined);
  });

  it('returns immediately, seeds stale data, and schedules an authoritative refresh', async () => {
    mocks.getQueryData
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ authenticated: true, id: 'viewer-1' });
    mocks.getThreadPreload.mockReturnValue(preload);

    const result = await fetchAndCacheThread('thread-1');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.thread.access_level).toBe('owner');
    expect(result.value.thread.messages[0]?.labels[0]).toMatchObject({
      provider_label_id: 'UNREAD',
      message_list_visibility: 'Show',
      type_: 'System',
    });
    expect(mocks.getThreadPreload).toHaveBeenCalledWith('thread-1', 'viewer-1');
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      expect.anything(),
      { pages: [result.value.thread], pageParams: [0] },
      { updatedAt: 0 }
    );
    expect(mocks.prefetchInfiniteQuery).toHaveBeenCalledOnce();
    expect(mocks.fetchInfiniteQuery).not.toHaveBeenCalled();
  });

  it('uses the authoritative query when no viewer-bound preload exists', async () => {
    const thread = {
      access_level: 'view',
      created_at: '2026-01-01T00:00:00Z',
      db_id: 'thread-1',
      inbox_visible: true,
      is_read: true,
      link_id: 'link-1',
      messages: [],
      updated_at: '2026-01-01T00:00:00Z',
    };
    mocks.getQueryData
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ authenticated: true, id: 'viewer-2' });
    mocks.getThreadPreload.mockReturnValue(undefined);
    mocks.fetchInfiniteQuery.mockResolvedValue({
      pages: [thread],
      pageParams: [0],
    });

    const result = await fetchAndCacheThread('thread-1');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.thread).toEqual(thread);
    expect(mocks.setQueryData).not.toHaveBeenCalled();
    expect(mocks.fetchInfiniteQuery).toHaveBeenCalledOnce();
  });
});
