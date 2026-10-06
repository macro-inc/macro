/**
 * The tools column at the left of the canvas, as in Photoshop: one button
 * per tool group showing the group's current tool (a press on the active
 * group lists the others), then the foreground and background colors with
 * swap (X) and reset (D). Presentational.
 */

import type { Rgb } from '@core/psd-engine/types';
import ArrowsLeftRight from '@phosphor/arrows-left-right.svg';
import ArrowsOutCardinal from '@phosphor/arrows-out-cardinal.svg';
import Circle from '@phosphor/circle.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import Crop from '@phosphor/crop.svg';
import Eraser from '@phosphor/eraser.svg';
import Eyedropper from '@phosphor/eyedropper.svg';
import Gradient from '@phosphor/gradient.svg';
import Hand from '@phosphor/hand.svg';
import Lasso from '@phosphor/lasso.svg';
import MagicWand from '@phosphor/magic-wand.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PaintBrush from '@phosphor/paint-brush.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Polygon from '@phosphor/polygon.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Selection from '@phosphor/selection.svg';
import TextT from '@phosphor/text-t.svg';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { css } from '../core/color';
import {
  EDIT_TOOLS,
  groupOf,
  TOOL_GROUPS,
  TOOL_LABELS,
  type Tool,
} from '../core/tools';

const TOOL_ICONS: Record<Tool, (props: { class?: string }) => JSX.Element> = {
  move: ArrowsOutCardinal,
  marqueeRect: Selection,
  marqueeEllipse: CircleDashed,
  lasso: Lasso,
  polygonLasso: Polygon,
  wand: MagicWand,
  crop: Crop,
  eyedropper: Eyedropper,
  brush: PaintBrush,
  pencil: PencilSimple,
  eraser: Eraser,
  gradient: Gradient,
  bucket: PaintBucket,
  type: TextT,
  rectangle: Rectangle,
  ellipse: Circle,
  hand: Hand,
  zoom: MagnifyingGlass,
};

export function Toolbar(props: {
  tool: Tool;
  /** The tool each group shows (its last used one). */
  shown: (groupKey: string) => Tool;
  editable: boolean;
  foreground: Rgb;
  background: Rgb;
  onTool: (tool: Tool) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  onPickColor: (which: 'foreground' | 'background') => void;
}) {
  /** The group whose tools are listed, beside its button. */
  const [flyout, setFlyoutState] = createSignal<{
    key: string;
    at: DOMRect;
  }>();
  let root!: HTMLDivElement;
  let list: HTMLDivElement | undefined;
  const openFlyout = (key: string, button: HTMLElement) =>
    setFlyoutState({ key, at: button.getBoundingClientRect() });
  const closeFlyout = () => setFlyoutState(undefined);
  const onDocumentDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!root.contains(target) && !list?.contains(target)) closeFlyout();
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));

  const groups = () =>
    TOOL_GROUPS.filter(
      (g) => props.editable || g.tools.some((t) => !EDIT_TOOLS.has(t))
    );
  const toolsOf = (key: string) =>
    (TOOL_GROUPS.find((g) => g.key === key)?.tools ?? []).filter(
      (t) => props.editable || !EDIT_TOOLS.has(t)
    );

  return (
    <div
      ref={root}
      class="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-edge-muted border-r bg-panel py-2"
      data-testid="psd-toolbar"
    >
      <For each={groups()}>
        {(group) => {
          const tool = () => {
            const shown = props.shown(group.key);
            return toolsOf(group.key).includes(shown)
              ? shown
              : (toolsOf(group.key)[0] ?? shown);
          };
          const active = () => groupOf(props.tool).key === group.key;
          return (
            <div class="relative">
              <button
                type="button"
                aria-pressed={active()}
                aria-label={`${TOOL_LABELS[tool()]} (${group.key})`}
                title={`${TOOL_LABELS[tool()]} · ${group.key}${toolsOf(group.key).length > 1 ? ` (⇧${group.key} cycles)` : ''}`}
                data-testid={`psd-tool-${tool()}`}
                class="relative flex size-8 items-center justify-center rounded-md"
                classList={{
                  'bg-accent/15 text-accent': active(),
                  'text-ink-muted hover:bg-hover hover:text-ink': !active(),
                }}
                onClick={(e) => {
                  if (active() && toolsOf(group.key).length > 1) {
                    if (flyout()?.key === group.key) closeFlyout();
                    else openFlyout(group.key, e.currentTarget);
                  } else props.onTool(tool());
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (toolsOf(group.key).length > 1)
                    openFlyout(group.key, e.currentTarget);
                }}
              >
                {TOOL_ICONS[tool()]({ class: 'size-4' })}
                <Show when={toolsOf(group.key).length > 1}>
                  <span class="absolute right-0.5 bottom-0.5 size-0 border-t-[3px] border-t-transparent border-r-[3px] border-r-current opacity-60" />
                </Show>
              </button>
              <Show when={flyout()?.key === group.key && flyout()}>
                {(open) => (
                  // Over the page: the toolbar scrolls, which would clip it.
                  <Portal>
                    <div
                      ref={list}
                      class="fixed z-50 w-52 rounded-lg border border-edge-muted bg-menu p-1 text-ink text-xs shadow-lg"
                      style={{
                        left: `${open().at.right + 4}px`,
                        top: `${open().at.top}px`,
                      }}
                    >
                      <For each={toolsOf(group.key)}>
                        {(t) => (
                          <button
                            type="button"
                            data-testid={`psd-tool-option-${t}`}
                            class="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                            onClick={() => {
                              props.onTool(t);
                              closeFlyout();
                            }}
                          >
                            {TOOL_ICONS[t]({ class: 'size-3.5' })}
                            <span class="flex-1">{TOOL_LABELS[t]}</span>
                            <span class="text-ink-muted">{group.key}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Portal>
                )}
              </Show>
            </div>
          );
        }}
      </For>
      <div class="mt-2 flex flex-col items-center gap-1">
        <div class="relative size-9">
          <button
            type="button"
            aria-label="Background color"
            title="Background color"
            data-testid="psd-background-color"
            class="absolute right-0 bottom-0 size-5 rounded-sm border border-edge shadow-sm"
            style={{ 'background-color': css(props.background) }}
            onClick={() => props.onPickColor('background')}
          />
          <button
            type="button"
            aria-label="Foreground color"
            title="Foreground color"
            data-testid="psd-foreground-color"
            class="absolute top-0 left-0 size-5 rounded-sm border border-edge shadow-sm"
            style={{ 'background-color': css(props.foreground) }}
            onClick={() => props.onPickColor('foreground')}
          />
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            aria-label="Default colors (D)"
            title="Default colors · D"
            data-testid="psd-default-colors"
            class="relative size-3.5"
            onClick={() => props.onResetColors()}
          >
            {/* Black over white, whatever the theme: they are the colors. */}
            <span
              class="absolute right-0 bottom-0 size-2 border border-edge"
              style={{ 'background-color': '#ffffff' }}
            />
            <span
              class="absolute top-0 left-0 size-2 border border-edge"
              style={{ 'background-color': '#000000' }}
            />
          </button>
          <button
            type="button"
            aria-label="Swap colors (X)"
            title="Swap colors · X"
            data-testid="psd-swap-colors"
            class="text-ink-muted hover:text-ink"
            onClick={() => props.onSwapColors()}
          >
            <ArrowsLeftRight class="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
