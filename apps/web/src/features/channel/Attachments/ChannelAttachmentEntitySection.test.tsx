import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
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
  useSoupAstItemsQuery: () => ({ isLoading: false, data: { entities: [] } }),
}));
vi.mock('@service-storage/client', () => ({
  stringToItemType: (type: string) => type,
}));
vi.mock('./AttachmentEntityList', () => ({ AttachmentEntityList: () => null }));
vi.mock('./attachment-utils', () => ({ getEntityClickContent: vi.fn() }));
vi.mock('./SectionHeader', () => ({
  AttachmentSection: (props: ParentProps) => props.children,
  LoadMoreButton: () => null,
}));

import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';

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
