import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { createSignal, Show } from 'solid-js';
import { AttachmentSection, LoadMoreButton } from './SectionHeader';

export function MediaGallery(props: {
  items: MediaItem[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = createSignal(0);
  const [viewerOpen, setViewerOpen] = createSignal(false);

  const hasMedia = () => props.items.length > 0;

  return (
    <AttachmentSection label="Photos and videos">
      <div class="grid p-3">
        <Show when={!hasMedia()}>
          <div class="py-3 text-sm text-ink-faint">
            No photos or videos in this channel yet.
          </div>
        </Show>

        <Show when={hasMedia()}>
          <div>
            <div
              aria-label="Photos and videos gallery"
              class="flex flex-row flex-wrap gap-1.5"
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

        <Show when={props.hasNextPage}>
          <LoadMoreButton
            onLoadMore={props.onLoadMore}
            isFetching={() => props.isFetchingNextPage}
          />
        </Show>
      </div>
    </AttachmentSection>
  );
}
