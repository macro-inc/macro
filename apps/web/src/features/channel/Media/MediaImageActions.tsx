import {
  createImageActions,
  ImageActionButtons,
} from '@core/component/ImageActions';
import type { MediaItem } from './media-items';

/**
 * Copy / download affordances for an image rendered inline in a message,
 * mirroring the lightbox toolbar. Call sites render this inside a
 * `group/media` positioned container.
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
    // Tailwind's hover variant is gated on `@media (hover: hover)`, so a
    // pointer that cannot hover would otherwise leave invisible buttons
    // sitting on top of the image.
    <div
      class="absolute top-2 right-2 flex flex-row items-center gap-0.5 rounded-lg border border-edge bg-surface p-0.5 opacity-0 shadow-md backdrop-blur-sm transition-opacity duration-150 group-hover/media:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={(event) => event.stopPropagation()}
    >
      <ImageActionButtons actions={actions} size="icon-sm" />
    </div>
  );
}
