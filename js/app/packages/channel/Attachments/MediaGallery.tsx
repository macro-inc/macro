import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { itemsPerRow, THUMB_GAP, THUMB_SIZE } from './attachment-utils';
import { AttachmentSection } from './SectionHeader';

/** Estimated virtual row height (tile + vertical gap). virtua measures the
 * real size after mount, so this only needs to be a reasonable starting point. */
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

  // Chunk the flat (newest-first) item list into rows of `columns` so the
  // virtualizer renders — and the browser downloads — only on-screen tiles.
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
    // Prefetch the next page a few rows before the user reaches the bottom.
    if (distanceFromBottom <= ROW_SIZE * 4) props.onLoadMore();
  };

  // Keep loading until the viewport is filled, so a short first page can't
  // strand additional pages behind an un-scrollable list (e.g. wide layouts
  // where one page is only a couple of rows tall).
  createEffect(() => {
    rows();
    void props.hasNextPage;
    void props.isFetchingNextPage;
    if (!handle()) return;
    requestAnimationFrame(maybeLoadMore);
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
