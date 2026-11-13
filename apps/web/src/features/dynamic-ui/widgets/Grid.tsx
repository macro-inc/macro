import { cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { Widget, WidgetOf } from '../view';
import { DashboardsOnly, DenseScope } from './panes/pane';

export type GridProps = Omit<WidgetOf<'grid'>, 'type'> & {
  /** Draws one child; the renderer passes its own dispatch. */
  render: (child: Widget) => JSX.Element;
};

/**
 * Panes in `columns` equal columns, each child spanning its entry in `spans`
 * (one by default), filled left to right. Below the grid's own `@2xl` width,
 * a phone or a narrow split, it is one column in the same order and rows fit
 * their panes.
 */
export function Grid(props: GridProps) {
  const span = (index: number) => {
    const wanted = props.spans?.[index] ?? 1;
    return Math.min(wanted, props.columns);
  };
  return (
    <DashboardsOnly>
      <DenseScope dense={props.dense}>
        <section
          aria-label={props.title}
          class="@container/grid flex w-full min-w-0 flex-col gap-2"
        >
          <Show when={props.title}>
            <h3 class="text-sm font-semibold text-ink">{props.title}</h3>
          </Show>
          <div
            class={cn(
              'grid w-full min-w-0 grid-cols-1 @2xl/grid:grid-cols-(--grid-columns)',
              props.dense ? 'gap-2' : 'gap-3',
              props.rowHeight !== undefined &&
                '@2xl/grid:auto-rows-(--grid-row-height)'
            )}
            style={{
              '--grid-columns': `repeat(${props.columns}, minmax(0, 1fr))`,
              '--grid-row-height':
                props.rowHeight === undefined
                  ? undefined
                  : `${props.rowHeight}px`,
            }}
          >
            <For each={props.children}>
              {(child, index) => (
                <div
                  data-grid-cell
                  class={cn(
                    'flex min-w-0 flex-col @2xl/grid:col-span-(--grid-span)',
                    props.rowHeight !== undefined &&
                      '@2xl/grid:min-h-0 @2xl/grid:overflow-auto'
                  )}
                  style={{ '--grid-span': String(span(index())) }}
                >
                  {props.render(child)}
                </div>
              )}
            </For>
          </div>
        </section>
      </DenseScope>
    </DashboardsOnly>
  );
}
