import { createSignal, onCleanup, Show } from 'solid-js';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { THUMB_SIZE, itemsPerRow } from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';

export function MediaGallery(props: {
  items: MediaItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [lightboxIndex, setLightboxIndex] = createSignal(0);
  const [viewerOpen, setViewerOpen] = createSignal(false);

  const observeGrid = (el: HTMLDivElement) => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const rowLimit = () => itemsPerRow(containerWidth());
  const hasMedia = () => props.items.length > 0;
  const hiddenCount = () => Math.max(0, props.items.length - rowLimit());
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
        <div>
          <div
            class="flex flex-row flex-wrap gap-1.5 pt-3 overflow-hidden transition-[max-height] duration-200"
            style={{
              'max-height': expanded()
                ? 'none'
                : `${collapsedMaxHeight() + 12}px`,
            }}
            ref={observeGrid}
          >
            <MediaGrid
              items={props.items}
              variant="attachments"
              onOpen={(index) => {
                setLightboxIndex(index);
                setViewerOpen(true);
              }}
            />
          </div>
          <MediaViewerDialog
            items={() => props.items}
            open={viewerOpen()}
            onOpenChange={setViewerOpen}
            currentIndex={lightboxIndex}
            onCurrentIndexChange={setLightboxIndex}
          />
        </div>
      </Show>

      <Show when={expanded() && props.hasNextPage}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={() => props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}
