import type {
  SheetChart,
  SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import ImageIcon from '@phosphor/image.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { ChartData } from '../core/chart-data';
import { chartScene } from '../core/chart-scene';
import { SpreadsheetChart } from './SpreadsheetChart';
import { SpreadsheetShape, shapeText } from './SpreadsheetShape';

/** A line is easier to press with this much room, in pixels. */
const MIN_TARGET = 10;
/** Images a browser shows itself. */
const SHOWN_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);/;

export type DrawingRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** The smallest drawing a gesture makes, in pixels. */
const MIN_SIZE = 16;
/** Arrow keys move or size a drawing this far; with Alt, one pixel. */
const STEP = 8;

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

const HANDLE_POSITIONS: Record<Handle, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
};

type Gesture = {
  id: string;
  /** The handle being dragged; none moves the drawing. */
  handle?: Handle;
  pointer: number;
  x: number;
  y: number;
  origin: DrawingRect;
  rect: DrawingRect;
  moved: boolean;
};

/** A box moved by (dx, dy), or with the handle's edges moved, kept in bounds. */
export function adjustedRect(
  origin: DrawingRect,
  dx: number,
  dy: number,
  handle: Handle | undefined,
  bounds: { left: number; top: number }
): DrawingRect {
  if (!handle)
    return {
      ...origin,
      left: Math.max(bounds.left, origin.left + dx),
      top: Math.max(bounds.top, origin.top + dy),
    };
  let { left, top } = origin;
  let right = origin.left + origin.width;
  let bottom = origin.top + origin.height;
  if (handle.includes('w'))
    left = Math.max(bounds.left, Math.min(right - MIN_SIZE, left + dx));
  if (handle.includes('e')) right = Math.max(left + MIN_SIZE, right + dx);
  if (handle.includes('n'))
    top = Math.max(bounds.top, Math.min(bottom - MIN_SIZE, top + dy));
  if (handle.includes('s')) bottom = Math.max(top + MIN_SIZE, bottom + dy);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Images and charts over a sheet's cells, positioned like the selection
 * overlays. A click selects one; dragging moves it and its handles size it.
 * From the keyboard: arrows move it (Shift sizes it, Alt by a pixel), Tab
 * goes to the next one, Enter edits a chart, Delete removes it and Escape
 * returns to the cells.
 */
export function SheetDrawingLayer(props: {
  drawings: SheetDrawing[];
  /** Where a drawing is, or undefined when it is outside the rendered area. */
  place: (drawing: SheetDrawing) => DrawingRect | undefined;
  /** The cells' top-left corner: drawings stay right of and below it. */
  bounds: { left: number; top: number };
  scale: number;
  image: (key: string) => string | undefined;
  chartData: (chart: SheetChart) => ChartData;
  /** The text a cell shows, for shapes linked to it. */
  cellText?: (reference: string) => string | undefined;
  /** The sheet's font, which shapes' text uses by default. */
  font?: string;
  selected?: string;
  readonly: boolean;
  onSelect: (id: string | undefined) => void;
  onDelete: (id: string) => void;
  onPlace: (id: string, rect: DrawingRect) => void;
  onEdit: (id: string) => void;
  onCycle: (id: string, backwards: boolean) => void;
  onReturnFocus: () => void;
}) {
  const [gesture, setGesture] = createSignal<Gesture>();
  // Keyed by id, so a drawing keeps its element, and focus, as it changes.
  const ids = createMemo(() => props.drawings.map((drawing) => drawing.id));
  const byId = createMemo(
    () => new Map(props.drawings.map((drawing) => [drawing.id, drawing]))
  );
  return (
    <For each={ids()}>
      {(id) => {
        const drawing = () => byId().get(id);
        const rect = () => {
          const current = gesture();
          if (current?.id === id) return current.rect;
          const value = drawing();
          return value && props.place(value);
        };
        const selected = () => props.selected === id;
        const editable = () => !props.readonly;
        const label = () => {
          const value = drawing();
          if (!value) return '';
          if (value.type === 'chart')
            return `Chart${value.chart.title ? `: ${value.chart.title}` : value.name ? `: ${value.name}` : ''}`;
          if (value.type === 'shape')
            return (
              shapeText(value.shape, props.cellText).slice(0, 200) ||
              value.name ||
              'Shape'
            );
          return value.description ?? value.name ?? 'Image';
        };
        // Lines may have no height or width; they are pressed in a margin.
        const target = () => {
          const box = rect();
          if (!box || drawing()?.type !== 'shape') return;
          const x = Math.max(0, (MIN_TARGET - box.width) / 2);
          const y = Math.max(0, (MIN_TARGET - box.height) / 2);
          return x || y ? { x, y } : undefined;
        };
        const nudge = (event: KeyboardEvent) => {
          const box = rect();
          if (!box) return;
          const step = (event.altKey ? 1 : STEP) * props.scale;
          const dx =
            event.key === 'ArrowLeft'
              ? -step
              : event.key === 'ArrowRight'
                ? step
                : 0;
          const dy =
            event.key === 'ArrowUp'
              ? -step
              : event.key === 'ArrowDown'
                ? step
                : 0;
          props.onPlace(
            id,
            adjustedRect(
              box,
              dx,
              dy,
              event.shiftKey ? (dx ? 'e' : 's') : undefined,
              props.bounds
            )
          );
        };
        return (
          <Show when={drawing() && rect()}>
            {(box) => (
              <div
                role="figure"
                aria-label={label()}
                aria-roledescription={drawing()?.type ?? 'image'}
                tabIndex={-1}
                data-drawing={id}
                class="absolute z-[3] outline-none"
                classList={{
                  'ring-2 ring-accent': selected(),
                  'touch-none': selected() && editable(),
                }}
                style={{
                  left: `${box().left - (target()?.x ?? 0)}px`,
                  top: `${box().top - (target()?.y ?? 0)}px`,
                  width: `${box().width + 2 * (target()?.x ?? 0)}px`,
                  height: `${box().height + 2 * (target()?.y ?? 0)}px`,
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  props.onSelect(id);
                  event.currentTarget.focus({ preventScroll: true });
                  const origin = rect();
                  if (!origin || !editable()) return;
                  const handle = (event.target as HTMLElement)
                    .closest('[data-handle]')
                    ?.getAttribute('data-handle') as Handle | undefined;
                  // On touch, a drawing moves once it is selected.
                  if (event.pointerType === 'touch' && !selected() && !handle)
                    return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setGesture({
                    id,
                    handle,
                    pointer: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    origin,
                    rect: origin,
                    moved: false,
                  });
                }}
                onPointerMove={(event) => {
                  const current = gesture();
                  if (current?.id !== id || current.pointer !== event.pointerId)
                    return;
                  const dx = event.clientX - current.x;
                  const dy = event.clientY - current.y;
                  if (!current.moved && Math.hypot(dx, dy) < 3) return;
                  setGesture({
                    ...current,
                    moved: true,
                    rect: adjustedRect(
                      current.origin,
                      dx,
                      dy,
                      current.handle,
                      props.bounds
                    ),
                  });
                }}
                onPointerUp={(event) => {
                  const current = gesture();
                  if (current?.id !== id || current.pointer !== event.pointerId)
                    return;
                  setGesture(undefined);
                  if (current.moved) props.onPlace(id, current.rect);
                }}
                onPointerCancel={() => {
                  if (gesture()?.id === id) setGesture(undefined);
                }}
                onMouseDown={(event) => {
                  // Focus is the drawing's, whatever part of it is pressed.
                  event.stopPropagation();
                  event.preventDefault();
                }}
                onDblClick={(event) => {
                  event.stopPropagation();
                  if (drawing()?.type === 'chart' && editable())
                    props.onEdit(id);
                }}
                onFocusOut={(event) => {
                  // Focus moving to this drawing's own controls keeps it
                  // selected, as does another drawing selected by the click.
                  if (
                    event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    )
                  )
                    return;
                  if (selected()) props.onSelect(undefined);
                }}
                onKeyDown={(event) => {
                  // The grid never handles keys meant for a drawing.
                  event.stopPropagation();
                  if (event.target !== event.currentTarget) return;
                  if (
                    (event.key === 'Delete' || event.key === 'Backspace') &&
                    editable()
                  ) {
                    event.preventDefault();
                    props.onDelete(id);
                    props.onReturnFocus();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    props.onSelect(undefined);
                    props.onReturnFocus();
                  } else if (event.key === 'Tab') {
                    event.preventDefault();
                    props.onCycle(id, event.shiftKey);
                  } else if (
                    event.key === 'Enter' &&
                    drawing()?.type === 'chart' &&
                    editable()
                  ) {
                    event.preventDefault();
                    props.onEdit(id);
                  } else if (event.key.startsWith('Arrow') && editable()) {
                    event.preventDefault();
                    nudge(event);
                  }
                }}
              >
                <div
                  class="size-full"
                  classList={{
                    'overflow-hidden': drawing()?.type !== 'shape',
                    'rounded-sm border border-edge-muted bg-surface':
                      drawing()?.type === 'chart',
                  }}
                  style={
                    target()
                      ? {
                          padding: `${target()?.y ?? 0}px ${target()?.x ?? 0}px`,
                        }
                      : undefined
                  }
                >
                  <Switch>
                    <Match
                      when={(() => {
                        const value = drawing();
                        return value?.type === 'shape' && value.shape;
                      })()}
                    >
                      {(shape) => (
                        <SpreadsheetShape
                          shape={shape()}
                          width={box().width}
                          height={box().height}
                          scale={props.scale}
                          font={props.font}
                          linked={props.cellText}
                        />
                      )}
                    </Match>
                    <Match
                      when={(() => {
                        const value = drawing();
                        if (value?.type !== 'image') return;
                        // A metafile shows its preview, if it has one.
                        const url = props.image(value.preview ?? value.image);
                        return url && SHOWN_IMAGE.test(url) ? url : undefined;
                      })()}
                    >
                      {(url) => (
                        <img
                          src={url()}
                          alt=""
                          draggable={false}
                          class="pointer-events-none size-full select-none"
                        />
                      )}
                    </Match>
                    <Match when={drawing()?.type === 'image'}>
                      <div class="flex size-full items-center justify-center gap-1.5 border border-dashed border-edge-muted bg-surface/80 p-1 text-xs text-ink-muted">
                        <ImageIcon class="size-4 shrink-0" />
                        <span class="truncate">{label()}</span>
                      </div>
                    </Match>
                  </Switch>
                  <Show
                    when={(() => {
                      const value = drawing();
                      return value?.type === 'chart' && value.chart;
                    })()}
                  >
                    {(chart) => {
                      const scene = createMemo(() =>
                        chartScene(
                          props.chartData(chart()),
                          box().width,
                          box().height,
                          props.scale
                        )
                      );
                      return (
                        <SpreadsheetChart
                          scene={scene()}
                          width={box().width}
                          height={box().height}
                          label={label()}
                        />
                      );
                    }}
                  </Show>
                </div>
                <Show when={selected() && editable()}>
                  <For each={HANDLES}>
                    {(handle) => (
                      <div
                        aria-hidden="true"
                        data-handle={handle}
                        class={`absolute size-2.5 rounded-[2px] border border-accent bg-surface touch:size-4 ${HANDLE_POSITIONS[handle]}`}
                      />
                    )}
                  </For>
                  <Show when={drawing()?.type === 'chart'}>
                    <button
                      type="button"
                      aria-label="Edit chart"
                      title="Edit chart (Enter)"
                      class="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-md border border-edge-muted bg-surface text-ink-muted hover:text-ink"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onEdit(id);
                      }}
                    >
                      <PencilSimple class="size-4" />
                    </button>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        );
      }}
    </For>
  );
}
