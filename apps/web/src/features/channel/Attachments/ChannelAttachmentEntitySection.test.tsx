import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  soupQuery: {} as Record<string, unknown>,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@app/features/projects/project-attachment', () => ({
  ProjectAttachment: (props: { id: string }) => <span>{props.id}</span>,
}));
vi.mock('@queries/channel/channel-attachments', () => ({
  useChannelDocumentAttachmentsQuery: () => fixture.query,
  flattenAttachments: (data?: { pages: { items: unknown[] }[] }) =>
    data?.pages.flatMap((page) => page.items) ?? [],
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => fixture.soupQuery,
}));
vi.mock('@service-storage/client', () => ({
  stringToItemType: (type: string) => type,
}));
vi.mock('./AttachmentEntityRow', () => ({
  AttachmentEntityRow: (props: { entity: { id: string } }) => (
    <span>{props.entity.id}</span>
  ),
}));
vi.mock('./AttachmentChipRow', () => ({
  AttachmentChipRow: (props: { attachment: { entity_id: string } }) => (
    <span>Chip {props.attachment.entity_id}</span>
  ),
}));
vi.mock('./attachment-utils', () => ({ getEntityClickContent: vi.fn() }));
vi.mock('./SectionHeader', () => ({
  AttachmentSection: (props: ParentProps<{ label: string }>) => (
    <section aria-label={props.label}>{props.children}</section>
  ),
  LoadMoreButton: (props: { onLoadMore(): void; isFetching(): boolean }) => (
    <button onClick={props.onLoadMore} disabled={props.isFetching()}>
      Load More
    </button>
  ),
}));

import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';

beforeEach(() => {
  fixture.soupQuery = {
    isPending: false,
    isLoading: false,
    data: { entities: [] },
  };
});
afterEach(cleanup);
it('retains cached project attachments after a background refetch failure without reading pending data', () => {
  const [pending, setPending] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  fixture.query = {
    get isPending() {
      return pending();
    },
    get isSuccess() {
      return !pending() && !failed();
    },
    get data() {
      if (pending()) throw new Error('Pending data must not be read');
      return {
        pages: [
          {
            items: [{ entity_type: 'initiative', entity_id: 'Shared project' }],
          },
        ],
      };
    },
    hasNextPage: false,
  };
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  expect(view.queryByText('Shared project')).toBeNull();
  expect(view.queryByText('No documents in this channel yet.')).toBeNull();
  expect(view.getByLabelText('Loading documents')).toBeTruthy();
  setPending(false);
  expect(view.getByText('Shared project')).toBeTruthy();
  setFailed(true);
  expect(view.getByText('Shared project')).toBeTruthy();
});

it.each([true, false])(
  'waits for document hydration before offering pagination (Soup returns the document: %s)',
  (soupReturnsDocument) => {
    const [loading, setLoading] = createSignal(true);
    const fetchNextPage = vi.fn();
    fixture.query = {
      isPending: false,
      data: {
        pages: [
          {
            items: [
              { entity_type: 'initiative', entity_id: 'Shared project' },
              { entity_type: 'document', entity_id: 'document' },
            ],
          },
        ],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    };
    fixture.soupQuery = {
      get isPending() {
        return loading();
      },
      get isLoading() {
        return loading();
      },
      get data() {
        if (loading()) throw new Error('Pending Soup data must not be read');
        return { entities: soupReturnsDocument ? [{ id: 'document' }] : [] };
      },
    };
    const view = render(() => (
      <ChannelAttachmentEntitySection channelId="channel" />
    ));
    expect(view.getByText('Shared project')).toBeTruthy();
    expect(view.queryByText('No documents in this channel yet.')).toBeNull();
    expect(view.getByLabelText('Loading documents')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Load More' })).toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();

    setLoading(false);
    expect(view.queryByLabelText('Loading documents')).toBeNull();
    expect(
      view.getByText(soupReturnsDocument ? 'document' : 'Chip document')
    ).toBeTruthy();
    expect(view.queryByText('No documents in this channel yet.')).toBeNull();
    const projects = view.getByRole('region', { name: 'Projects' });
    expect(projects.querySelector('button')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Load More' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  }
);

it('lists a trashed document beside live ones instead of saying there are none', () => {
  fixture.query = {
    isPending: false,
    data: {
      pages: [
        {
          items: [
            {
              entity_type: 'initiative',
              entity_id: 'Deleted project',
              created_at: '2026-11-18T08:03:00Z',
            },
            {
              entity_type: 'document',
              entity_id: 'Trashed plan',
              created_at: '2026-11-18T08:02:00Z',
            },
            {
              entity_type: 'document',
              entity_id: 'Live notes',
              created_at: '2026-11-18T08:01:00Z',
            },
          ],
        },
      ],
    },
    hasNextPage: false,
  };
  fixture.soupQuery = {
    isPending: false,
    isLoading: false,
    data: { entities: [{ id: 'Live notes' }] },
  };
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  const documents = view.getByRole('region', { name: 'Documents' });
  expect(view.queryByText('No documents in this channel yet.')).toBeNull();
  expect(documents.textContent).toBe('Chip Trashed planLive notes');
  expect(view.getByText('Deleted project')).toBeTruthy();
});

it('keeps pagination available for a page containing only projects', () => {
  const fetchNextPage = vi.fn();
  fixture.query = {
    isPending: false,
    data: {
      pages: [
        {
          items: [{ entity_type: 'initiative', entity_id: 'Shared project' }],
        },
      ],
    },
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage,
  };
  fixture.soupQuery = {
    isPending: true,
    isLoading: false,
    get data() {
      throw new Error('Disabled Soup data must not be read');
    },
  };
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  expect(view.queryByLabelText('Loading documents')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Load More' }));
  expect(fetchNextPage).toHaveBeenCalledOnce();
});

it('keeps loading instead of showing chips while Soup is paused offline', () => {
  fixture.query = {
    isPending: false,
    data: {
      pages: [
        {
          items: [
            {
              entity_type: 'document',
              entity_id: 'Offline notes',
              created_at: '2026-11-18T08:01:00Z',
            },
          ],
        },
      ],
    },
    hasNextPage: false,
  };
  fixture.soupQuery = {
    isPending: true,
    isLoading: false,
    get data() {
      throw new Error('Paused Soup data must not be read');
    },
  };
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  expect(view.getByLabelText('Loading documents')).toBeTruthy();
  expect(view.queryByText('Chip Offline notes')).toBeNull();
  expect(view.queryByText('No documents in this channel yet.')).toBeNull();
});

it('adds chips for a new page only once Soup answers for it', () => {
  const [placeholder, setPlaceholder] = createSignal(true);
  fixture.query = {
    isPending: false,
    data: {
      pages: [
        {
          items: [
            {
              entity_type: 'document',
              entity_id: 'Trashed plan',
              created_at: '2026-11-18T08:02:00Z',
            },
            {
              entity_type: 'document',
              entity_id: 'Live notes',
              created_at: '2026-11-18T08:01:00Z',
            },
          ],
        },
      ],
    },
    hasNextPage: false,
  };
  fixture.soupQuery = {
    isPending: false,
    isLoading: false,
    get isPlaceholderData() {
      return placeholder();
    },
    data: { entities: [{ id: 'Live notes' }] },
  };
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  const documents = view.getByRole('region', { name: 'Documents' });
  expect(documents.textContent).toBe('Live notes');
  setPlaceholder(false);
  expect(documents.textContent).toBe('Chip Trashed planLive notes');
});
