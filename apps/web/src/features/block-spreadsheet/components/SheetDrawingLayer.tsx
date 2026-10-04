import type {
  SheetChart,
  SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { createMemo, For, Show } from 'solid-js';
import type { ChartData } from '../core/chart-data';
import { chartScene } from '../core/chart-scene';
import { SpreadsheetChart } from './SpreadsheetChart';

export type DrawingRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Images and charts over a sheet's cells, positioned like the selection
 * overlays. A click selects one; Delete removes it, Escape returns to the
 * cells.
 */
export function SheetDrawingLayer(props: {
  drawings: SheetDrawing[];
  /** Where a drawing is, or undefined when it is outside the rendered area. */
  place: (drawing: SheetDrawing) => DrawingRect | undefined;
  scale: number;
  image: (key: string) => string | undefined;
  chartData: (chart: SheetChart) => ChartData;
  selected?: string;
  readonly: boolean;
  onSelect: (id: string | undefined) => void;
  onDelete: (id: string) => void;
  onReturnFocus: () => void;
}) {
  return (
    <For each={props.drawings}>
      {(drawing) => {
        const rect = () => props.place(drawing);
        const selected = () => props.selected === drawing.id;
        const label = () =>
          drawing.type === 'chart'
            ? `Chart${drawing.chart.title ? `: ${drawing.chart.title}` : drawing.name ? `: ${drawing.name}` : ''}`
            : (drawing.description ?? drawing.name ?? 'Image');
        return (
          <Show when={rect()}>
            {(box) => (
              <div
                role="figure"
                aria-label={label()}
                tabIndex={-1}
                data-drawing={drawing.id}
                class="absolute z-[3] overflow-hidden outline-none"
                classList={{
                  'ring-2 ring-accent': selected(),
                  'rounded-sm border border-edge-muted bg-surface':
                    drawing.type === 'chart',
                }}
                style={{
                  left: `${box().left}px`,
                  top: `${box().top}px`,
                  width: `${box().width}px`,
                  height: `${box().height}px`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  props.onSelect(drawing.id);
                  event.currentTarget.focus({ preventScroll: true });
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onDblClick={(event) => event.stopPropagation()}
                onFocusOut={() => {
                  // Another drawing may already be selected by the same click.
                  if (selected()) props.onSelect(undefined);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (
                    (event.key === 'Delete' || event.key === 'Backspace') &&
                    !props.readonly
                  ) {
                    event.preventDefault();
                    props.onDelete(drawing.id);
                    props.onReturnFocus();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    props.onSelect(undefined);
                    props.onReturnFocus();
                  }
                }}
              >
                <Show
                  when={drawing.type === 'chart' && drawing.chart}
                  fallback={
                    <Show
                      when={
                        drawing.type === 'image' && props.image(drawing.image)
                      }
                    >
                      {(url) => (
                        <img
                          src={url()}
                          alt=""
                          draggable={false}
                          class="pointer-events-none size-full select-none"
                        />
                      )}
                    </Show>
                  }
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
            )}
          </Show>
        );
      }}
    </For>
  );
}
