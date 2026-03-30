import { type Accessor, createMemo, For, Show, Suspense } from 'solid-js';
import {
  flattenAttachments,
  useChannelAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import type { ApiChannelAttachment } from '@service-comms/client';
import { useSoupItemsQuery } from '@queries/soup/items';
import type { EntityData } from '@entity';
import { useSplitLayout } from '@app/component/split-layout/layout';
import {
  isDocumentAttachment,
  buildAttachmentEntityFilters,
  getEntityClickContent,
} from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';
import { AttachmentEntityRow } from './AttachmentEntityRow';
import { MediaGallery } from './MediaGallery';
import { ThumbnailSkeleton, DocumentRowSkeleton } from './Skeletons';

const MEDIA_SKELETON_COUNT = 6;
const DOCUMENT_SKELETON_COUNT = 6;

function AttachmentEntityList(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  onLoadMore: () => void;
}) {
  const documentAttachments = createMemo(() =>
    props.attachments().filter(isDocumentAttachment)
  );
  const hasDocuments = () => documentAttachments().length > 0;

  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 500 },
      body: buildAttachmentEntityFilters(documentAttachments()),
    }),
    () => ({ enabled: hasDocuments() })
  );

  const attachmentByEntityId = createMemo(() => {
    const map = new Map<string, ApiChannelAttachment>();
    for (const a of documentAttachments()) map.set(a.entity_id, a);
    return map;
  });

  const sortedEntities = () => {
    const entities = soupQuery.data ?? [];
    const lookup = attachmentByEntityId();
    return [...entities].sort((a, b) => {
      const aTime = lookup.get(a.id)?.created_at ?? '';
      const bTime = lookup.get(b.id)?.created_at ?? '';
      return bTime.localeCompare(aTime);
    });
  };

  const { replaceOrInsertSplit } = useSplitLayout();
  const handleEntityClick = (entity: EntityData) =>
    replaceOrInsertSplit(getEntityClickContent(entity));

  return (
    <div class="flex flex-col">
      <SectionHeader label="Documents" />

      <Show when={!hasDocuments()}>
        <div class="text-sm text-ink-faint px-2 py-3">
          No documents in this channel yet.
        </div>
      </Show>

      <Show when={hasDocuments()}>
        <Suspense
          fallback={
            <For each={Array.from({ length: DOCUMENT_SKELETON_COUNT })}>
              {() => <DocumentRowSkeleton />}
            </For>
          }
        >
          <For each={sortedEntities()}>
            {(entity) => {
              const attachment = attachmentByEntityId().get(entity.id);
              return (
                <AttachmentEntityRow
                  entity={entity}
                  timestamp={attachment?.created_at}
                  senderId={attachment?.sender_id}
                  onClick={() => handleEntityClick(entity)}
                />
              );
            }}
          </For>
        </Suspense>
      </Show>

      <Show when={hasDocuments() && props.hasNextPage()}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}

function AttachmentsTabSkeleton() {
  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4 flex flex-col gap-6">
        <div class="flex flex-col">
          <SectionHeader label="Photos and videos" />
          <div class="flex flex-row flex-wrap gap-1.5 pt-3">
            <For each={Array.from({ length: MEDIA_SKELETON_COUNT })}>
              {() => <ThumbnailSkeleton />}
            </For>
          </div>
        </div>
        <div class="flex flex-col">
          <SectionHeader label="Documents" />
          <For each={Array.from({ length: DOCUMENT_SKELETON_COUNT })}>
            {() => <DocumentRowSkeleton />}
          </For>
        </div>
      </div>
    </div>
  );
}

function AttachmentsTabContent(props: { channelId: string }) {
  const attachmentsQuery = useChannelAttachmentsQuery(() => props.channelId);

  const allAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.data as ChannelAttachmentsData | undefined
    )
  );

  const hasNextPage = () => !!attachmentsQuery.hasNextPage;
  const isFetchingNextPage = () => attachmentsQuery.isFetchingNextPage;
  const loadMore = () => attachmentsQuery.fetchNextPage();

  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4 flex flex-col gap-6">
        <MediaGallery
          attachments={allAttachments}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
        <AttachmentEntityList
          attachments={allAttachments}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      </div>
    </div>
  );
}

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <Suspense fallback={<AttachmentsTabSkeleton />}>
      <AttachmentsTabContent channelId={props.channelId} />
    </Suspense>
  );
}
