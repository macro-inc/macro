import { muteItemForEntity } from '@entity/utils/notification';
import type { ApiThreadPreviewCursor } from '@service-email/generated/schemas';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSnoozeEmails } from './snooze-emails';

const clients = vi.hoisted(() => ({
  getPreviews: vi.fn(),
  search: vi.fn(),
}));
vi.mock('@service-email/client', () => ({ emailClient: clients }));
vi.mock('@service-search/client', () => ({ searchClient: clients }));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [] }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'No Subject',
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/user', () => ({ emailToId: (email: string) => email }));

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function preview(id: string, name: string): ApiThreadPreviewCursor {
  return {
    id,
    name,
    ownerId: 'owner',
    linkId: 'inbox',
    createdAt: '2026-09-26T09:00:00Z',
    updatedAt: '2026-09-26T09:00:00Z',
    sortTs: '2026-09-26T09:00:00Z',
    inboxVisible: true,
    isDraft: false,
    isImportant: false,
    isRead: true,
    contacts: [],
    attachments: [],
    labels: [],
  };
}

function searchResult(id: string, name: string) {
  return {
    type: 'email',
    id,
    thread_id: id,
    name,
    owner_id: 'owner',
    link_id: 'inbox',
    participants: [],
    email_message_search_results: [],
  };
}

function setup() {
  const [term, setTerm] = createSignal('');
  let emails!: ReturnType<typeof useSnoozeEmails>;
  function Harness() {
    emails = useSnoozeEmails(term, () => true);
    return (
      <output>
        {emails
          .items()
          .map((item) => item.id)
          .join(',')}
      </output>
    );
  }
  const screen = render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback="Loading">
        <Harness />
      </Suspense>
    </QueryClientProvider>
  ));
  return { emails, setTerm, screen };
}

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

describe('email threads in the snooze picker', () => {
  it('browses and paginates email threads without requiring a separate API token', async () => {
    clients.getPreviews
      .mockResolvedValueOnce(
        ok({ items: [preview('recent', 'Recent email')], next_cursor: 'older' })
      )
      .mockResolvedValueOnce(ok({ items: [preview('older', 'Older email')] }));
    const { emails } = setup();
    await waitFor(() => expect(emails.items()).toHaveLength(1));
    expect(muteItemForEntity(emails.items()[0])).toEqual({
      item_id: 'recent',
      item_type: 'email_thread',
    });
    expect(emails.hasMore()).toBe(true);
    await emails.loadMore();
    await waitFor(() =>
      expect(emails.items().map((item) => item.id)).toEqual(['recent', 'older'])
    );
    expect(clients.getPreviews.mock.calls[1][0]).toMatchObject({
      view: 'all',
      cursor: 'older',
    });
    expect(clients.getPreviews.mock.calls[0]).toEqual([
      { view: 'all', limit: 50, sort_method: undefined, cursor: undefined },
    ]);
    expect(emails.hasMore()).toBe(false);
    expect(clients.search).not.toHaveBeenCalled();
  });

  it('filters short searches locally and finds unbrowsed threads through paginated server search', async () => {
    clients.getPreviews.mockResolvedValue(
      ok({
        items: [
          preview('local', 'Invoice recent'),
          preview('other', 'Meeting'),
        ],
      })
    );
    clients.search
      .mockResolvedValueOnce(
        ok({
          results: [
            searchResult('local', 'Invoice recent'),
            searchResult('remote', 'Invoice archive'),
          ],
          next_cursor: 'page-2',
        })
      )
      .mockResolvedValueOnce(
        ok({ results: [searchResult('page-2', 'Invoice last year')] })
      );
    const { emails, setTerm } = setup();
    await waitFor(() => expect(emails.items()).toHaveLength(2));
    setTerm('ME');
    await waitFor(() =>
      expect(emails.items().map((item) => item.id)).toEqual(['other'])
    );
    expect(clients.search).not.toHaveBeenCalled();
    setTerm('invoice');
    await waitFor(() =>
      expect(emails.items().map((item) => item.id)).toEqual(['local', 'remote'])
    );
    expect(clients.search.mock.calls[0][0].request).toMatchObject({
      query: 'invoice',
      include: ['emails'],
      search_on: 'name',
    });
    expect(emails.hasMore()).toBe(true);
    await emails.loadMore();
    await waitFor(() =>
      expect(emails.items().map((item) => item.id)).toEqual([
        'local',
        'remote',
        'page-2',
      ])
    );
    expect(clients.search.mock.calls[1][0].params.cursor).toBe('page-2');
    expect(muteItemForEntity(emails.items()[2])).toEqual({
      item_id: 'page-2',
      item_type: 'email_thread',
    });
    expect(emails.hasMore()).toBe(false);
  });

  it('does not show stale remote matches while a different search is pending or too short', async () => {
    clients.getPreviews.mockResolvedValue(ok({ items: [] }));
    clients.search
      .mockResolvedValueOnce(
        ok({ results: [searchResult('remote', 'Invoice archive')] })
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const { emails, setTerm } = setup();
    setTerm('invoice');
    await waitFor(() => expect(emails.items()).toHaveLength(1));
    setTerm('vacation');
    await waitFor(() => expect(emails.items()).toEqual([]));
    expect(emails.isLoading()).toBe(true);
    setTerm('i');
    await waitFor(() => expect(emails.isLoading()).toBe(false));
    expect(emails.items()).toEqual([]);
  });
});
