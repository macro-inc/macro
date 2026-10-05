/**
 * A small preview of a library asset (or this file's copy of one): the
 * PNG the engine rendered, or the kind's icon while there is none.
 * Presentational: the caller hands over the rendering.
 */

import type { PublishedAsset } from '@core/fig-engine/library-types';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import { createResource, type JSX, Show } from 'solid-js';

export function AssetThumbnail(props: {
  /** Renders the preview (an object URL), or `null` when nothing draws. */
  src: () => Promise<string | null>;
  label: string;
  class?: string;
  /** Revoke the URL when unmounted (it was made for this preview only). */
  owned?: boolean;
}) {
  const [url] = createResource(props.src);
  return (
    <span
      class={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-inset ${props.class ?? 'size-8'}`}
    >
      <Show
        when={url.latest}
        fallback={<DiamondsFour class="size-3.5 text-accent" />}
      >
        {(src) => (
          <img
            src={src()}
            alt={props.label}
            class="max-h-full max-w-full object-contain"
            onLoad={() => props.owned && URL.revokeObjectURL(src())}
          />
        )}
      </Show>
    </span>
  );
}

/** A style or variable's swatch: its color, or its kind's initials. */
export function AssetSwatch(props: { asset: PublishedAsset }): JSX.Element {
  const color = () => {
    const v = props.asset.variable?.color;
    if (v) return `#${v}`;
    const paint = props.asset.style?.paints[0];
    return paint?.color ? `#${paint.color}` : undefined;
  };
  const label = () =>
    props.asset.style?.type === 'TEXT'
      ? 'Ag'
      : props.asset.style?.type === 'EFFECT'
        ? 'Fx'
        : '';
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center rounded border border-edge-muted text-[10px] text-ink-muted"
      style={{ background: color() }}
    >
      {label()}
    </span>
  );
}
