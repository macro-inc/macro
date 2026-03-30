import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import type { ApiChannelAttachment } from '@service-comms/client';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import { THUMB_SIZE, isMediaAttachment, itemsPerRow } from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';

const THUMB_GAP = 6;

export function MediaGallery(props: {
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

  const allMedia = createMemo(() =>
    props.attachments().filter(isMediaAttachment)
  );
  const allImages = createMemo(() =>
    allMedia().filter((a) => a.entity_type === STATIC_IMAGE)
  );
  const allVideos = () =>
    allMedia().filter((a) => a.entity_type === STATIC_VIDEO);

  const imagePreviewData = () =>
    allImages().map((a) => ({
      id: a.entity_id,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    }));
  const imageAttachmentIds = () => allImages().map((a) => a.id);

  const rowLimit = () => itemsPerRow(containerWidth());
  const hasMedia = () => allMedia().length > 0;
  const hiddenCount = () => Math.max(0, allMedia().length - rowLimit());

  const collapsedMaxHeight = () => {
    const rows = 1;
    return rows * THUMB_SIZE + (rows - 1) * THUMB_GAP;
  };

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
        <div
          class="flex flex-row flex-wrap gap-1.5 pt-3 overflow-hidden transition-[max-height] duration-200"
          style={{
            'max-height': expanded()
              ? 'none'
              : `${collapsedMaxHeight() + 12}px`,
          }}
          ref={observeGrid}
        >
          <Show when={allImages().length > 0}>
            <ImageGalleryPreview
              images={imagePreviewData()}
              attachmentIds={imageAttachmentIds()}
              variant="small"
              square
              wrapperClass="contents"
            />
          </Show>
          <For each={allVideos()}>
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
