import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { chartModeLabel, type QueryChartData } from '../core/query-chart';
import { PieChart } from './pie-chart';
import { PlotChart } from './plot-chart';

/** Presentation only; SQL, permission checks and validation live upstream. */
export function QueryChart(props: { data: QueryChartData }) {
  const [element, setElement] = createSignal<HTMLElement>();
  const size = createElementSize(element);
  // The figure's padding and border; the chart draws inside them.
  const width = () => Math.max(180, (size.width || 346) - 26);
  const label = () =>
    `${props.data.title}. ${chartModeLabel(props.data.mark)}.`;
  return (
    <figure
      ref={setElement}
      class="min-w-0 space-y-3 rounded-lg border border-edge-muted bg-panel p-3"
    >
      <figcaption class="text-sm font-medium text-ink">
        {props.data.title}
      </figcaption>
      <Switch>
        <Match when={props.data.mark === 'pie'}>
          <PieChart data={props.data} width={width()} label={label()} />
        </Match>
        <Match when={props.data.mark !== 'pie'}>
          <PlotChart data={props.data} width={width()} label={label()} />
        </Match>
      </Switch>
      <Show when={props.data.omitted > 0}>
        <p class="text-[11px] text-ink-muted">
          {props.data.omitted === 1
            ? `1 record without a ${props.data.config.x} isn’t shown.`
            : `${props.data.omitted} records without a ${props.data.config.x} aren’t shown.`}
        </p>
      </Show>
    </figure>
  );
}
