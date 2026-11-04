import {
  createImageActions,
  ImageActionButtons,
} from '@core/component/ImageActions';
import { cn } from '@ui';
import type { MediaItem } from './media-items';

/**
 * Copy / download affordances for an image rendered inline in a message,
 * mirroring the lightbox toolbar and styled like the inline video toolbar.
 * Call sites render this inside a `group/media` positioned container.
 *
 * Only mount this for pointer devices: `createImageActions` pre-fetches the
 * full-resolution blob on iOS, which would mean downloading every inline image
 * in the channel at full size.
 */
export function MediaImageActions(props: { item: MediaItem }) {
  const actions = createImageActions({
    src: () => props.item.fullSrc,
    imageId: () => props.item.id,
  });

  return (
    // Hidden buttons ignore the pointer, so a tap on a touchscreen laptop
    // (where this mounts) opens the viewer instead of an unseen action.
    <div
      class={cn(
        'pointer-events-none absolute right-2 top-2 z-10 flex items-center rounded-full bg-surface/90 opacity-0 transition-opacity group-hover/media:pointer-events-auto group-hover/media:opacity-100 group-focus-within/media:pointer-events-auto group-focus-within/media:opacity-100',
        actions.isBusy() && 'pointer-events-auto opacity-100'
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <ImageActionButtons actions={actions} />
    </div>
  );
}
