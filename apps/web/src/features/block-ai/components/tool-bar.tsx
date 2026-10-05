/**
 * Illustrator's toolbar, floating at the canvas's left: the tools, and the
 * fill and stroke new objects get (or the selection has) with swap (⇧X)
 * and default (D). Presentational.
 */

import ArrowsDownUp from '@phosphor/arrows-down-up.svg';
import Circle from '@phosphor/circle.svg';
import Eyedropper from '@phosphor/eyedropper.svg';
import FrameCorners from '@phosphor/frame-corners.svg';
import Hand from '@phosphor/hand.svg';
import LineSegment from '@phosphor/line-segment.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import NavigationArrow from '@phosphor/navigation-arrow.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Polygon from '@phosphor/polygon.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Star from '@phosphor/star.svg';
import TextT from '@phosphor/text-t.svg';
import NavigationArrowFill from '@phosphor-fill/navigation-arrow-fill.svg';
import { Button } from '@ui/components/Button';
import { type Component, For, type JSX } from 'solid-js';
import { TOOLS, type Tool } from '../core/tools';
import { PaintSwatch } from './paint-swatch';

const ICONS: Record<Tool, Component<JSX.SvgSVGAttributes<SVGSVGElement>>> = {
  select: NavigationArrowFill,
  direct: NavigationArrow,
  pen: PenNib,
  type: TextT,
  line: LineSegment,
  rectangle: Rectangle,
  ellipse: Circle,
  polygon: Polygon,
  star: Star,
  eyedropper: Eyedropper,
  artboard: FrameCorners,
  hand: Hand,
  zoom: MagnifyingGlass,
};

/** A paint as the toolbar's swatches show it. */
export interface SwatchPaint {
  /** CSS background. */
  css: string;
  /** `RRGGBB`. */
  hex: string;
  none: boolean;
}

export function ToolBar(props: {
  tool: Tool;
  editable: boolean;
  onTool: (tool: Tool) => void;
  fill: SwatchPaint;
  stroke: SwatchPaint;
  onFill?: (hex: string | null, live: boolean) => void;
  onStroke?: (hex: string | null, live: boolean) => void;
  onSwap?: () => void;
  onDefault?: () => void;
}) {
  const tools = () => TOOLS.filter((t) => props.editable || !t.edit);
  return (
    <div
      class="absolute top-3 left-3 z-10 flex flex-col items-center gap-0.5 rounded-xl border border-edge-muted bg-menu p-1 shadow-lg"
      data-testid="ai-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <For each={tools()}>
        {(t) => {
          const Icon = ICONS[t.tool];
          return (
            <Button
              variant="ghost"
              size="icon-md"
              aria-pressed={props.tool === t.tool}
              class={
                props.tool === t.tool ? 'bg-accent/15 text-accent' : undefined
              }
              label={t.key ? `${t.label} (${t.key})` : t.label}
              tooltip={t.key ? `${t.label} · ${t.key}` : t.label}
              data-testid={`ai-tool-${t.tool}`}
              onClick={() => props.onTool(t.tool)}
            >
              <Icon
                class={
                  t.tool === 'select' || t.tool === 'direct'
                    ? '-scale-x-100'
                    : undefined
                }
              />
            </Button>
          );
        }}
      </For>
      <div aria-hidden="true" class="my-1 h-px w-6 bg-edge-muted" />
      <div class="relative size-10">
        <PaintSwatch
          class="absolute top-0 left-0 z-[1] size-6"
          swatch={props.fill.css}
          hex={props.fill.hex}
          none={props.fill.none}
          label="Fill"
          testId="ai-swatch-fill"
          disabled={!props.editable}
          onChange={props.onFill}
        />
        <PaintSwatch
          class="absolute right-0 bottom-0 size-6"
          ring
          swatch={props.stroke.css}
          hex={props.stroke.hex}
          none={props.stroke.none}
          label="Stroke"
          testId="ai-swatch-stroke"
          disabled={!props.editable}
          onChange={props.onStroke}
        />
      </div>
      <div class="flex gap-0.5">
        <button
          type="button"
          class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
          aria-label="Swap fill and stroke (⇧X)"
          title="Swap fill and stroke · ⇧X"
          data-testid="ai-swap-colors"
          disabled={!props.onSwap}
          onClick={() => props.onSwap?.()}
        >
          <ArrowsDownUp class="size-3" />
        </button>
        <button
          type="button"
          class="relative size-4 rounded p-0.5 hover:bg-hover disabled:opacity-40"
          aria-label="Default fill and stroke (D)"
          title="Default fill and stroke · D"
          data-testid="ai-default-colors"
          disabled={!props.onDefault}
          onClick={() => props.onDefault?.()}
        >
          <span class="absolute top-0.5 left-0.5 size-2 border border-ink bg-surface" />
          <span class="absolute right-0.5 bottom-0.5 size-2 border-2 border-ink" />
        </button>
      </div>
    </div>
  );
}
