import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import {
  flattenAttachments,
  useChannelAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import type { ApiChannelAttachment } from '@service-comms/client';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import type { EntityData } from '@entity';
import { useSplitLayout } from '@app/component/split-layout/layout';
import {
  THUMB_SIZE,
  isMediaAttachment,
  isDocumentAttachment,
  itemsPerRow,
  buildAttachmentEntityFilters,
  getEntityClickContent,
} from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';
import { AttachmentEntityRow } from './AttachmentEntityRow';
import { ThumbnailSkeleton, DocumentRowSkeleton } from './Skeletons';

const MEDIA_SKELETON_COUNT = 6;
const DOCUMENT_SKELETON_COUNT = 6;

function MediaGallery(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [containerWidth, setContainerWidth] = createSignal(0);

  const observeGrid = (el: HTMLDivElement) => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const rowLimit = () => itemsPerRow(containerWidth());
  const allMedia = createMemo(() =>
    props.attachments().filter(isMediaAttachment)
  );
  const visibleMedia = createMemo(() =>
    expanded() ? allMedia() : allMedia().slice(0, rowLimit())
  );
  const hiddenCount = () => Math.max(0, allMedia().length - rowLimit());
  const visibleImages = createMemo(() =>
    visibleMedia().filter((a) => a.entity_type === STATIC_IMAGE)
  );
  const visibleVideos = () =>
    visibleMedia().filter((a) => a.entity_type === STATIC_VIDEO);
  const imagePreviewData = () =>
    visibleImages().map((a) => ({
      id: a.entity_id,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    }));
  const imageAttachmentIds = () => visibleImages().map((a) => a.id);
  const hasMedia = () => allMedia().length > 0;

  return (
    <div class="flex flex-col">
      <SectionHeader
        label="Photos and videos"
        action={
          <Show when={hiddenCount() > 0}>
            <button
              type="button"
              class="flex items-center gap-1 text-xs font-medium text-ink-muted/70 hover:text-ink-muted transition-colors"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded() ? 'Show less' : 'See all'}
              <ChevronDownIcon
                class="w-3 h-3 transition-transform"
                classList={{ 'rotate-180': expanded() }}
              />
            </button>
          </Show>
        }
      />

      <Show when={!hasMedia()}>
        <div class="text-sm text-ink-faint px-2 py-3">
          No photos or videos in this channel yet.
        </div>
      </Show>

      <Show when={hasMedia()}>
        <div class="flex flex-row flex-wrap gap-1.5 pt-3" ref={observeGrid}>
          <Show when={visibleImages().length > 0}>
            <ImageGalleryPreview
              images={imagePreviewData()}
              attachmentIds={imageAttachmentIds()}
              variant="small"
              square
              wrapperClass="contents"
            />
          </Show>
          <For each={visibleVideos()}>
            {(video) => (
              <VideoPreview
                id={video.entity_id}
                variant="small"
                width={video.width ?? undefined}
                height={video.height ?? undefined}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={expanded() && props.hasNextPage()}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}

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
