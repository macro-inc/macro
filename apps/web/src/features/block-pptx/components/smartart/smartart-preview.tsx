/**
 * A SmartArt gallery picture: the engine's own layout of a layout's sample
 * diagram, in a color variation and style, drawn as SVG.
 */

import type { SmartArtPreviewPath } from '@core/pptx-engine/types';
import { For, Show } from 'solid-js';

export function SmartArtPreview(props: {
  paths: SmartArtPreviewPath[] | null | undefined;
  width: number;
  height: number;
  class?: string;
}) {
  // A margin like PowerPoint's gallery pictures.
  const pad = () => Math.round(Math.min(props.width, props.height) * 0.08);
  return (
    <svg
      viewBox={`${-pad()} ${-pad()} ${props.width + 2 * pad()} ${props.height + 2 * pad()}`}
      class={props.class}
      aria-hidden="true"
    >
      <Show
        when={props.paths}
        fallback={
          <rect
            x={props.width * 0.15}
            y={props.height * 0.3}
            width={props.width * 0.7}
            height={props.height * 0.4}
            rx="2"
            class="fill-ink/5"
          />
        }
      >
        {(paths) => (
          <For each={paths()}>
            {(p) => (
              <path
                d={p.d}
                fill={p.fill ?? 'none'}
                fill-opacity={p.fillOpacity}
                stroke={p.stroke ?? 'none'}
                stroke-width={p.strokeWidth}
                stroke-linejoin="round"
              />
            )}
          </For>
        )}
      </Show>
    </svg>
  );
}
