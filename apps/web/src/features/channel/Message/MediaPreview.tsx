import { MediaGrid } from '@channel/Media/MediaGrid';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import { useMediaDensity } from '@channel/Media/media-density';
import type { MediaItem } from '@channel/Media/media-items';
import { createSignal } from 'solid-js';

type MediaPreviewProps = {
  items: MediaItem[];
  class?: string;
  /** An item whose file failed to load. */
  onError?: (id: string) => void;
};

export function MediaPreview(props: MediaPreviewProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [viewerOpen, setViewerOpen] = createSignal(false);
  const density = useMediaDensity();

  return (
    <>
      <MediaGrid
        items={props.items}
        variant={density() === 'compact' ? 'compact' : 'message'}
        class={props.class}
        onError={props.onError}
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
