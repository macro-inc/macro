/**
 * Dotted outlines of a master's or layout's placeholders, which Slide
 * Master view shows so empty placeholders (pictures, charts, footers) can be
 * found and grabbed. Drawn in slide coordinates under the selection chrome.
 */

import type { SlideOutline } from '@core/pptx-engine/types';
import { For } from 'solid-js';
import { boxOf, corners } from '../core/geometry';

export function PlaceholderOutlines(props: {
  page: SlideOutline;
  width: number;
  height: number;
  /** Points per CSS pixel, so the dots keep their on-screen size. */
  unit: number;
}) {
  const placeholders = () =>
    props.page.shapes.filter((s) => s.placeholder && !s.hidden);
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-hidden="true"
      data-testid="pptx-placeholder-outlines"
    >
      <For each={placeholders()}>
        {(shape) => (
          <polygon
            data-placeholder={shape.placeholder}
            points={corners(boxOf(shape))
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
            class="fill-none stroke-ink-muted"
            stroke-width={props.unit}
            stroke-dasharray={`${2 * props.unit} ${2 * props.unit}`}
          />
        )}
      </For>
    </svg>
  );
}
