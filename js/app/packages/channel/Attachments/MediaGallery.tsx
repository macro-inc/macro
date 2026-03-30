import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Dialog } from '@kobalte/core/dialog';
import { STATIC_IMAGE } from '@core/store/cacheChannelInput';
import { Lightbox } from '@core/component/Lightbox';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { SERVER_HOSTS } from '@core/constant/servers';
import type { ApiChannelAttachment } from '@service-comms/client';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import PlayIcon from '@icon/fill/play-fill.svg';
import { THUMB_SIZE, isMediaAttachment, itemsPerRow } from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';

const IMAGE_THUMB_CLASS =
  'size-23 object-cover rounded-2xl border border-edge hover:opacity-80 select-none cursor-pointer';
const VIDEO_THUMB_CLASS =
  'size-23 overflow-hidden rounded-2xl border border-edge bg-menu select-none relative cursor-pointer group';

export function MediaGallery(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [lightboxIndex, setLightboxIndex] = createSignal(0);

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

  const imageIds = createMemo(() =>
    allMedia()
      .filter((a) => a.entity_type === STATIC_IMAGE)
      .map((a) => a.entity_id)
  );

  const imageIndexOf = (entityId: string) => imageIds().indexOf(entityId);

  const getImageUrl = (id: string) =>
    `${SERVER_HOSTS['static-file']}/file/${id}`;

  const currentImageUrl = () => {
    const id = imageIds()[lightboxIndex()];
    return id ? getImageUrl(id) : undefined;
  };

  const hasPrevious = () => lightboxIndex() > 0;
  const hasNext = () => lightboxIndex() < imageIds().length - 1;

  const rowLimit = () => itemsPerRow(containerWidth());
  const hasMedia = () => allMedia().length > 0;
  const hiddenCount = () => Math.max(0, allMedia().length - rowLimit());
  const collapsedMaxHeight = () => THUMB_SIZE;

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
        <Dialog
          onOpenChange={(open) => {
            if (!open) setLightboxIndex(0);
          }}
        >
          <div
            class="flex flex-row flex-wrap gap-1.5 pt-3 overflow-hidden transition-[max-height] duration-200"
            style={{
              'max-height': expanded()
                ? 'none'
                : `${collapsedMaxHeight() + 12}px`,
            }}
            ref={observeGrid}
          >
            <For each={allMedia()}>
              {(attachment) =>
                attachment.entity_type === STATIC_IMAGE ? (
                  <Dialog.Trigger
                    class="flex"
                    onClick={() =>
                      setLightboxIndex(imageIndexOf(attachment.entity_id))
                    }
                  >
                    <img
                      class={IMAGE_THUMB_CLASS}
                      src={getImageUrl(attachment.entity_id)}
                      alt="preview"
                      width={THUMB_SIZE}
                      height={THUMB_SIZE}
                      loading="lazy"
                    />
                  </Dialog.Trigger>
                ) : (
                  <div
                    class={VIDEO_THUMB_CLASS}
                    onClick={() =>
                      window.open(
                        staticFileIdEndpoint(attachment.entity_id),
                        '_blank'
                      )
                    }
                  >
                    <video
                      class="size-full object-cover"
                      preload="metadata"
                      playsinline
                      muted
                      src={staticFileIdEndpoint(attachment.entity_id)}
                    />
                    <div class="absolute inset-0 flex items-center justify-center bg-ink/20 group-hover:bg-ink/30 transition-colors">
                      <PlayIcon class="size-5 text-page drop-shadow" />
                    </div>
                  </div>
                )
              }
            </For>
          </div>
          <Dialog.Portal>
            <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
            <Lightbox
              src={currentImageUrl}
              imageId={() => imageIds()[lightboxIndex()] ?? ''}
              onPrevious={
                hasPrevious() ? () => setLightboxIndex((i) => i - 1) : undefined
              }
              onNext={
                hasNext() ? () => setLightboxIndex((i) => i + 1) : undefined
              }
              indexLabel={
                imageIds().length > 1
                  ? () => `${lightboxIndex() + 1}/${imageIds().length}`
                  : undefined
              }
            />
          </Dialog.Portal>
        </Dialog>
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
