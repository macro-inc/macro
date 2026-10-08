/**
 * View ▸ Guides on the editing stage: the deck's drawing guides as dashed
 * lines over the slide (reaching a little past its edges, as in
 * PowerPoint), the layout's and master's guides, the guide being dragged,
 * and its position tooltip in inches from the slide's center.
 */

import type { GuideOutline } from '@core/pptx-engine/types';
import { For, Show } from 'solid-js';
import { DEFAULT_GUIDE_COLOR, guideLabel } from '../core/guides';
import { swatchCss } from '../core/palette';
import type { GuideDrag } from '../primitives/create-guides';

/** How far (CSS pixels) guides reach past the slide's edges. */
const OVERHANG = 24;

function GuideLine(props: {
  guide: { orient: GuideOutline['orient']; position: number; color?: string };
  width: number;
  height: number;
  scale: number;
  themeColors: [string, string][];
  testId: string;
  index?: number;
  dragging?: boolean;
}) {
  const reach = () => OVERHANG / props.scale;
  const color = () =>
    swatchCss(props.guide.color ?? DEFAULT_GUIDE_COLOR, props.themeColors) ??
    `#${DEFAULT_GUIDE_COLOR}`;
  const horizontal = () => props.guide.orient === 'horizontal';
  return (
    <line
      data-testid={props.testId}
      data-orient={props.guide.orient}
      data-position={props.guide.position.toFixed(2)}
      data-index={props.index}
      x1={horizontal() ? -reach() : props.guide.position}
      x2={horizontal() ? props.width + reach() : props.guide.position}
      y1={horizontal() ? props.guide.position : -reach()}
      y2={horizontal() ? props.guide.position : props.height + reach()}
      stroke={color()}
      stroke-width={(props.dragging ? 1.5 : 1) / props.scale}
      stroke-dasharray={`${4 / props.scale} ${3 / props.scale}`}
    />
  );
}

export function GuidesOverlay(props: {
  width: number;
  height: number;
  scale: number;
  guides: GuideOutline[];
  layoutGuides: GuideOutline[];
  drag: GuideDrag | null;
  themeColors: [string, string][];
}) {
  /** The deck's guides, without the one being moved (not copied). */
  const resting = () =>
    props.guides
      .map((guide, index) => ({ guide, index }))
      .filter(({ index }) => {
        const d = props.drag;
        return !(d?.moved && !d.copy && d.index === index);
      });
  const moving = () => {
    const d = props.drag;
    if (!d?.moved || d.off) return undefined;
    const from = props.guides[d.index];
    return { orient: d.orient, position: d.position, color: from?.color };
  };
  return (
    <>
      <svg
        class="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox={`0 0 ${props.width} ${props.height}`}
        preserveAspectRatio="none"
        data-testid="pptx-guides"
        aria-hidden="true"
      >
        <For each={props.layoutGuides}>
          {(guide) => (
            <GuideLine
              guide={guide}
              width={props.width}
              height={props.height}
              scale={props.scale}
              themeColors={props.themeColors}
              testId="pptx-layout-guide"
            />
          )}
        </For>
        <For each={resting()}>
          {(item) => (
            <GuideLine
              guide={item.guide}
              index={item.index}
              width={props.width}
              height={props.height}
              scale={props.scale}
              themeColors={props.themeColors}
              testId="pptx-guide"
            />
          )}
        </For>
        <Show when={moving()}>
          {(guide) => (
            <GuideLine
              guide={guide()}
              width={props.width}
              height={props.height}
              scale={props.scale}
              themeColors={props.themeColors}
              testId="pptx-guide-moving"
              dragging
            />
          )}
        </Show>
      </svg>
      <Show when={props.drag?.moved ? props.drag : undefined}>
        {(d) => (
          <div
            class="pointer-events-none absolute z-10 whitespace-nowrap rounded-sm border border-edge bg-menu px-1.5 py-0.5 text-ink text-xs tabular-nums shadow-md"
            style={{
              left: `${d().pointer.x * props.scale + 14}px`,
              top: `${d().pointer.y * props.scale + 16}px`,
            }}
            data-testid="pptx-guide-tooltip"
          >
            {d().off
              ? 'Delete guide'
              : guideLabel(d().orient, d().position, {
                  w: props.width,
                  h: props.height,
                })}
          </div>
        )}
      </Show>
    </>
  );
}

/** View ▸ Guides' picture: a slide crossed by dashed guides. */
export function GuidesIcon(props: { class?: string }) {
  return (
    <svg viewBox="0 0 16 16" class={props.class ?? 'size-4'} aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1"
        fill="none"
        stroke="currentColor"
      />
      <path
        d="M8 0.5v15M0 8h16"
        fill="none"
        stroke="currentColor"
        stroke-dasharray="1.5 1.5"
      />
    </svg>
  );
}
