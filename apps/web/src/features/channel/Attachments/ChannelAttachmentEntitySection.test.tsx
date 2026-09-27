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
vi.mock('./AttachmentEntityList', () => ({ AttachmentEntityList: () => null }));
vi.mock('./attachment-utils', () => ({ getEntityClickContent: vi.fn() }));
vi.mock('./SectionHeader', () => ({
  AttachmentSection: (props: ParentProps) => props.children,
  LoadMoreButton: (props: { onLoadMore(): void; isFetching(): boolean }) => (
    <button onClick={props.onLoadMore} disabled={props.isFetching()}>
      Load More
    </button>
  ),
}));

import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';

beforeEach(() => {
  fixture.soupQuery = { isLoading: false, data: { entities: [] } };
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
  setPending(false);
  expect(view.getByText('Shared project')).toBeTruthy();
  setFailed(true);
  expect(view.getByText('Shared project')).toBeTruthy();
});

it.each([true, false])(
  'waits for document hydration before offering project pagination (documents visible: %s)',
  (hasDocuments) => {
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
      get isLoading() {
        return loading();
      },
      get data() {
        if (loading()) throw new Error('Pending Soup data must not be read');
        return { entities: hasDocuments ? [{ id: 'document' }] : [] };
      },
    };
    const view = render(() => (
      <ChannelAttachmentEntitySection channelId="channel" />
    ));
    expect(view.getByText('Shared project')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Load More' })).toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();

    setLoading(false);
    if (hasDocuments) {
      expect(view.queryByRole('button', { name: 'Load More' })).toBeNull();
    } else {
      fireEvent.click(view.getByRole('button', { name: 'Load More' }));
      expect(fetchNextPage).toHaveBeenCalledOnce();
    }
  }
);

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
  const view = render(() => (
    <ChannelAttachmentEntitySection channelId="channel" />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Load More' }));
  expect(fetchNextPage).toHaveBeenCalledOnce();
});
