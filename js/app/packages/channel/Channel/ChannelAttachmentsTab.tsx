import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
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

/** size-23 = 92px, gap-1.5 = 6px */
const THUMB_SIZE = 92;
const THUMB_GAP = 6;

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

function MediaSection(props: { channelId: string }) {
  const query = useChannelAttachmentsQuery(() => props.channelId);
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

  const allMedia = createMemo(() => {
    const flat = flattenAttachments(
      query.data as ChannelAttachmentsData | undefined
    );
    return flat.filter(isMediaAttachment);
  });

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
  const isLoading = () => query.isLoading;

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

      <Show when={isLoading()}>
        <div class="text-sm text-ink-faint">Loading...</div>
      </Show>

      <Show when={!isLoading() && !hasMedia()}>
        <div class="text-sm text-ink-faint">
          No photos or videos in this channel yet.
        </div>
      </Show>

      <Show when={!isLoading() && hasMedia()}>
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
    </div>
  );
}

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4">
        <MediaSection channelId={props.channelId} />
      </div>
    </div>
  );
}
