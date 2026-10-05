/**
 * What a design shows while the engine opens it: the preview Figma stored
 * in the file (large designs take seconds to decode), under a status line.
 */

import { figThumbnail } from '@core/fig-engine/thumbnail';
import { onCleanup, Show } from 'solid-js';

export function FigOpening(props: { bytes?: ArrayBuffer }) {
  const png = props.bytes ? figThumbnail(props.bytes) : null;
  const url = png
    ? URL.createObjectURL(new Blob([png.slice()], { type: 'image/png' }))
    : undefined;
  onCleanup(() => {
    if (url) URL.revokeObjectURL(url);
  });
  return (
    <div
      class="relative flex size-full flex-col items-center justify-center gap-3 p-6 text-ink-muted text-sm"
      data-testid="fig-opening"
    >
      <Show when={url}>
        {(src) => (
          <img
            src={src()}
            alt=""
            class="max-h-[60%] max-w-[80%] object-contain opacity-60"
            data-testid="fig-opening-preview"
          />
        )}
      </Show>
      Opening design…
    </div>
  );
}
