import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
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
import { isItemType, stringToItemType } from '@service-storage/client';
import { type EntityData, Entity } from '@entity';
import { match } from 'ts-pattern';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useSplitLayout } from '@app/component/split-layout/layout';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import type { DateValue } from '@core/util/date';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** size-23 = 92px, gap-1.5 = 6px */
const THUMB_SIZE = 92;
const THUMB_GAP = 6;

/** UUID that matches no real entity — zeroes out a soup filter so it returns nothing. */
const NIL_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemsPerRow(containerWidth: number): number {
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((containerWidth + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP))
  );
}

function isMediaAttachment(a: ApiChannelAttachment): boolean {
  return a.entity_type === STATIC_IMAGE || a.entity_type === STATIC_VIDEO;
}

function isDocumentAttachment(a: ApiChannelAttachment): boolean {
  if (isMediaAttachment(a)) return false;
  const itemType = stringToItemType(a.entity_type);
  return itemType !== undefined && isItemType(a.entity_type);
}

/**
 * Build soup query filters that fetch only the given entity IDs,
 * grouped by type. Unused entity types are zeroed out with NIL_ID
 * so they return nothing instead of everything.
 */
function buildAttachmentEntityFilters(attachments: ApiChannelAttachment[]) {
  const documentIds: string[] = [];
  const emailIds: string[] = [];
  const chatIds: string[] = [];
  const channelIds: string[] = [];
  const projectIds: string[] = [];

  for (const a of attachments) {
    const itemType = stringToItemType(a.entity_type);
    switch (itemType) {
      case 'document':
        documentIds.push(a.entity_id);
        break;
      case 'email':
        emailIds.push(a.entity_id);
        break;
      case 'chat':
        chatIds.push(a.entity_id);
        break;
      case 'channel':
        channelIds.push(a.entity_id);
        break;
      case 'project':
        projectIds.push(a.entity_id);
        break;
    }
  }

  return {
    document_filters: {
      document_ids: documentIds.length > 0 ? documentIds : [NIL_ID],
    },
    email_filters: {
      email_thread_ids: emailIds.length > 0 ? emailIds : [NIL_ID],
    },
    chat_filters: { chat_ids: chatIds.length > 0 ? chatIds : [NIL_ID] },
    channel_filters: {
      channel_ids: channelIds.length > 0 ? channelIds : [NIL_ID],
    },
    project_filters: {
      project_ids: projectIds.length > 0 ? projectIds : [NIL_ID],
    },
  };
}

function getEntityClickContent(entity: EntityData) {
  return match(entity)
    .with({ type: 'document' }, (e) => ({
      type: fileTypeToBlockName(e.subType?.type ?? e.fileType),
      id: e.id,
    }))
    .with({ type: 'chat' }, (e) => ({ type: 'chat' as const, id: e.id }))
    .with({ type: 'email' }, (e) => ({ type: 'email' as const, id: e.id }))
    .with({ type: 'channel' }, (e) => ({
      type: 'channel' as const,
      id: e.id,
    }))
    .with({ type: 'project' }, (e) => ({
      type: 'project' as const,
      id: e.id,
    }))
    .exhaustive();
}

// ---------------------------------------------------------------------------
// AttachmentEntityRow — lightweight read-only entity row
// ---------------------------------------------------------------------------

function AttachmentEntityRow(props: {
  entity: EntityData;
  timestamp?: DateValue | null;
  onClick?: () => void;
}) {
  return (
    <Entity.Root
      entity={props.entity}
      onClick={() => props.onClick?.()}
      class="flex items-center gap-2 min-h-10 px-2 text-sm hover:bg-hover/30 cursor-pointer w-full"
    >
      <div class="size-4 shrink-0">
        <Entity.Icon entity={props.entity} />
      </div>
      <span class="ph-no-capture font-semibold truncate flex-1">
        <Entity.Title entity={props.entity} />
      </span>
      <span class="text-xs font-mono text-ink-extra-muted uppercase font-light shrink-0">
        <Entity.Timestamp
          entity={props.entity}
          overrideTimeStamp={props.timestamp ?? undefined}
        />
      </span>
    </Entity.Root>
  );
}

// ---------------------------------------------------------------------------
// LoadMoreButton
// ---------------------------------------------------------------------------

function LoadMoreButton(props: {
  onLoadMore: () => void;
  isFetching: Accessor<boolean>;
}) {
  return (
    <button
      type="button"
      class="flex items-center justify-center gap-2 w-full py-2 text-xs font-medium text-accent hover:text-accent/80 transition-colors rounded-md hover:bg-hover/30"
      onClick={() => props.onLoadMore()}
      disabled={props.isFetching()}
    >
      <Show
        when={!props.isFetching()}
        fallback={
          <>
            <Spinner class="w-3.5 h-3.5 animate-spin" />
            Loading...
          </>
        }
      >
        Load more
      </Show>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MediaSection
// ---------------------------------------------------------------------------

function MediaSection(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  isLoading: Accessor<boolean>;
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

  const rowLimit = createMemo(() => itemsPerRow(containerWidth()));

  const allMedia = createMemo(() =>
    props.attachments().filter(isMediaAttachment)
  );

  const visibleMedia = createMemo(() => {
    if (expanded()) return allMedia();
    return allMedia().slice(0, rowLimit());
  });

  const hiddenCount = createMemo(() =>
    Math.max(0, allMedia().length - rowLimit())
  );

  const visibleImages = createMemo(() =>
    visibleMedia().filter((a) => a.entity_type === STATIC_IMAGE)
  );

  const visibleVideos = createMemo(() =>
    visibleMedia().filter((a) => a.entity_type === STATIC_VIDEO)
  );

  const imagePreviewData = createMemo(() =>
    visibleImages().map((a) => ({
      id: a.entity_id,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    }))
  );

  const imageAttachmentIds = createMemo(() => visibleImages().map((a) => a.id));

  const hasMedia = createMemo(() => allMedia().length > 0);

  const showLoadMore = createMemo(() => expanded() && props.hasNextPage());

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Photos and videos
        </h3>
        <Show when={hiddenCount() > 0}>
          <button
            type="button"
            class="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded() ? 'Show less' : 'See all'}
            <ChevronDownIcon
              class="w-3 h-3 transition-transform"
              classList={{ 'rotate-180': expanded() }}
            />
          </button>
        </Show>
      </div>

      <Show when={props.isLoading()}>
        <div class="text-sm text-ink-faint">Loading...</div>
      </Show>

      <Show when={!props.isLoading() && !hasMedia()}>
        <div class="text-sm text-ink-faint">
          No photos or videos in this channel yet.
        </div>
      </Show>

      <Show when={!props.isLoading() && hasMedia()}>
        <div class="flex flex-row flex-wrap gap-1.5" ref={observeGrid}>
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

      <Show when={showLoadMore()}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentsSection
// ---------------------------------------------------------------------------

function DocumentsSection(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  isLoading: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  onLoadMore: () => void;
}) {
  const documentAttachments = createMemo(() =>
    props.attachments().filter(isDocumentAttachment)
  );

  const hasDocuments = createMemo(() => documentAttachments().length > 0);

  const filters = createMemo(() =>
    buildAttachmentEntityFilters(documentAttachments())
  );

  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 500 },
      body: filters(),
    }),
    () => ({ enabled: hasDocuments() })
  );

  const attachmentByEntityId = createMemo(() => {
    const map = new Map<string, ApiChannelAttachment>();
    for (const a of documentAttachments()) {
      map.set(a.entity_id, a);
    }
    return map;
  });

  const sortedEntities = createMemo(() => {
    const entities = soupQuery.data ?? [];
    const lookup = attachmentByEntityId();
    return [...entities].sort((a, b) => {
      const aTime = lookup.get(a.id)?.created_at ?? '';
      const bTime = lookup.get(b.id)?.created_at ?? '';
      return bTime.localeCompare(aTime);
    });
  });

  const { replaceOrInsertSplit } = useSplitLayout();

  const handleEntityClick = (entity: EntityData) => {
    const content = getEntityClickContent(entity);
    replaceOrInsertSplit(content);
  };

  const isLoading = () =>
    props.isLoading() || (hasDocuments() && soupQuery.isLoading);

  return (
    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-medium text-ink-muted uppercase tracking-wide shrink-0">
        Documents
      </h3>

      <Show when={isLoading()}>
        <div class="text-sm text-ink-faint">Loading...</div>
      </Show>

      <Show when={!isLoading() && sortedEntities().length === 0}>
        <div class="text-sm text-ink-faint">
          No documents in this channel yet.
        </div>
      </Show>

      <Show when={!isLoading() && sortedEntities().length > 0}>
        <div>
          <For each={sortedEntities()}>
            {(entity) => {
              const attachment = attachmentByEntityId().get(entity.id);
              return (
                <AttachmentEntityRow
                  entity={entity}
                  timestamp={attachment?.created_at}
                  onClick={() => handleEntityClick(entity)}
                />
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={!isLoading() && hasDocuments() && props.hasNextPage()}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelAttachmentsTab
// ---------------------------------------------------------------------------

export function ChannelAttachmentsTab(props: { channelId: string }) {
  const attachmentsQuery = useChannelAttachmentsQuery(() => props.channelId);

  const allAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.data as ChannelAttachmentsData | undefined
    )
  );

  const isInitialLoading = () => attachmentsQuery.isLoading;
  const hasNextPage = () => !!attachmentsQuery.hasNextPage;
  const isFetchingNextPage = () => attachmentsQuery.isFetchingNextPage;
  const loadMore = () => attachmentsQuery.fetchNextPage();

  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4 flex flex-col gap-6">
        <MediaSection
          attachments={allAttachments}
          isLoading={isInitialLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
        <DocumentsSection
          attachments={allAttachments}
          isLoading={isInitialLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      </div>
    </div>
  );
}
