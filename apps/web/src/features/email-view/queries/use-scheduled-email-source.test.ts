import type { Message } from '@service-email/generated/schemas';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailViewState } from '../types';
import { useScheduledEmailSource } from './use-scheduled-email-source';

const mocks = vi.hoisted(() => ({
  links: {
    isSuccess: true,
    isError: false,
    isLoading: false,
    error: null as Error | null,
    data: { links: [{ id: 'inbox-a' }] },
    refetch: vi.fn(async () => {}),
  },
  scheduled: {
    isSuccess: true,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    data: [] as Message[],
    refetch: vi.fn(async () => {}),
  },
  scheduledEnabled: undefined as (() => boolean) | undefined,
}));

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/collection/rows')),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => mocks.links,
}));
vi.mock('@queries/email/scheduled', () => ({
  useScheduledMessagesQuery: (_linkIds: unknown, enabled: () => boolean) => {
    mocks.scheduledEnabled = enabled;
    return mocks.scheduled;
  },
}));

function message(id: string, threadId: string, sendTime: string): Message {
  return {
    db_id: id,
    thread_db_id: threadId,
    link_id: 'inbox-a',
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    to: [{ email: 'peter@example.test', name: 'Peter' }],
    cc: [],
    bcc: [],
    is_draft: true,
    is_read: true,
    is_sent: false,
    is_starred: false,
    has_attachments: false,
    labels: [],
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    scheduled_send_time: sendTime,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-21T12:00:00Z',
  } as Message;
}

let dispose: (() => void) | undefined;
function mount() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [state] = createStore<EmailViewState>({
      tab: 'scheduled',
      search: '',
      inboxIds: undefined,
      facets: {},
      collapsedSidebarSectionIds: [],
    });
    return useScheduledEmailSource(state);
  });
}

describe('scheduled email source', () => {
  afterEach(() => {
    dispose?.();
    vi.clearAllMocks();
    mocks.links.isSuccess = true;
    mocks.links.isError = false;
    mocks.links.error = null;
    mocks.scheduled.data = [];
  });

  it('lists one row per thread, soonest send first, timed by the send', () => {
    mocks.scheduled.data = [
      message('first', 'thread-a', '2026-09-27T12:00:00Z'),
      message('second', 'thread-a', '2026-09-28T12:00:00Z'),
      message('third', 'thread-b', '2026-09-29T12:00:00Z'),
    ];
    const source = mount();

    const entities = source
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));
    expect(entities.map((entity) => entity.id)).toEqual([
      'thread-a',
      'thread-b',
    ]);
    expect(entities[0]).toMatchObject({
      type: 'email',
      name: 'Subject first',
      isDraft: true,
      ownerId: 'alice',
      scheduledSendTime: '2026-09-27T12:00:00Z',
      participants: [{ email: 'peter@example.test', name: 'Peter' }],
    });
    expect(source.hasMore()).toBe(false);
  });

  it('retries the inbox list when that is what failed', async () => {
    mocks.links.isSuccess = false;
    mocks.links.isError = true;
    mocks.links.error = new Error('links failed');
    const source = mount();

    expect(mocks.scheduledEnabled?.()).toBe(false);
    expect(source.error()).toBe(mocks.links.error);
    await source.refresh();
    expect(mocks.links.refetch).toHaveBeenCalledOnce();
    expect(mocks.scheduled.refetch).not.toHaveBeenCalled();
  });

  it('refreshes the scheduled read once the inbox list has loaded', async () => {
    const source = mount();
    await source.refresh();
    expect(mocks.scheduled.refetch).toHaveBeenCalledOnce();
    expect(mocks.links.refetch).not.toHaveBeenCalled();
  });
});
