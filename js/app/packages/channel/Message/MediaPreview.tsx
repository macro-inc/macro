import { createSignal } from 'solid-js';
import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';

type MediaPreviewProps = {
  items: MediaItem[];
  class?: string;
};

export function MediaPreview(props: MediaPreviewProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [viewerOpen, setViewerOpen] = createSignal(false);

  return (
    <>
      <MediaGrid
        items={props.items}
        variant="message"
        class={props.class}
        onOpen={(index) => {
          setSelectedIndex(index);
          setViewerOpen(true);
        }}
      />
      <MediaViewerDialog
        items={() => props.items}
        open={viewerOpen()}
        onOpenChange={setViewerOpen}
        currentIndex={selectedIndex}
        onCurrentIndexChange={setSelectedIndex}
      />
    </>
  );
}
