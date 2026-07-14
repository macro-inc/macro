import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { itemsPerRow, THUMB_GAP, THUMB_SIZE } from './attachment-utils';
import { AttachmentSection } from './SectionHeader';

// Initial row-height estimate; virtua measures the real size after mount.
const ROW_SIZE = THUMB_SIZE + THUMB_GAP;

export function MediaGallery(props: {
  items: MediaItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = createSignal(0);
  const [viewerOpen, setViewerOpen] = createSignal(false);

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const containerSize = createElementSize(containerRef);
  const [handle, setHandle] = createSignal<VirtualizerHandle>();

  const hasMedia = () => props.items.length > 0;
  const columns = createMemo(() => itemsPerRow(containerSize.width ?? 0));

  // Chunk into rows so the virtualizer renders (and downloads) only on-screen tiles.
  const rows = createMemo(() => {
    const cols = columns();
    const out: MediaItem[][] = [];
    for (let i = 0; i < props.items.length; i += cols) {
      out.push(props.items.slice(i, i + cols));
    }
    return out;
  });

  const maybeLoadMore = () => {
    const h = handle();
    if (!h || !props.hasNextPage || props.isFetchingNextPage) return;
    const distanceFromBottom = h.scrollSize - h.viewportSize - h.scrollOffset;
    if (distanceFromBottom <= ROW_SIZE * 4) props.onLoadMore();
  };

  // A short first page may not fill the viewport (e.g. wide layouts); keep
  // pulling pages until it does. maybeLoadMore no-ops while a fetch is in
  // flight or once there's no next page, so the loop terminates.
  createEffect(() => {
    rows();
    if (handle()) requestAnimationFrame(maybeLoadMore);
  });

  const openAt = (index: number) => {
    setLightboxIndex(index);
    setViewerOpen(true);
  };

  return (
    <AttachmentSection label="Photos and Videos" fillBody>
      <Show
        when={hasMedia()}
        fallback={
          <div class="px-6 py-3 text-sm text-ink-faint">
            No photos or videos in this channel yet.
          </div>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col px-6 py-2">
          <div
            ref={setContainerRef}
            aria-label="Photos and videos gallery"
            class="min-h-0 flex-1"
          >
            <VList
              ref={(h) => setHandle(h)}
              data={rows()}
              itemSize={ROW_SIZE}
              class="size-full overscroll-none"
              onScroll={maybeLoadMore}
            >
              {(row, rowIndex) => (
                <MediaGrid
                  items={row}
                  variant="attachments"
                  class="justify-center pb-1.5"
                  onOpen={(localIndex) =>
                    openAt(rowIndex() * columns() + localIndex)
                  }
                />
              )}
            </VList>
          </div>
        </div>
      </Show>

      <MediaViewerDialog
        items={() => props.items}
        open={viewerOpen()}
        onOpenChange={setViewerOpen}
        currentIndex={lightboxIndex}
        onCurrentIndexChange={setLightboxIndex}
      />
    </AttachmentSection>
  );
}
