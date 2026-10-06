import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { CHART_PALETTE } from '../core/chart-palette';
import type { QueryChartData } from '../core/query-chart';
import { type PlotMark, plotChart } from '../core/query-chart-plot';

type PlotModule = typeof import('@observablehq/plot');

// Plot loads with the first chart, so documents without one never fetch it.
let plotModule: Promise<PlotModule> | undefined;
function loadPlot(): Promise<PlotModule> {
  plotModule ??= import('@observablehq/plot');
  return plotModule;
}

function buildMark(Plot: PlotModule, mark: PlotMark) {
  return match(mark)
    .with({ mark: 'barX' }, ({ data, options }) => Plot.barX(data, options))
    .with({ mark: 'barY' }, ({ data, options }) => Plot.barY(data, options))
    .with({ mark: 'lineY' }, ({ data, options }) => Plot.lineY(data, options))
    .with({ mark: 'areaY' }, ({ data, options }) => Plot.areaY(data, options))
    .with({ mark: 'dot' }, ({ data, options }) => Plot.dot(data, options))
    .with({ mark: 'ruleX' }, ({ data, options }) => Plot.ruleX(data, options))
    .with({ mark: 'ruleY' }, ({ data, options }) => Plot.ruleY(data, options))
    .exhaustive();
}

/**
 * A series chart drawn by Observable Plot. Plot returns a finished element,
 * so it is rebuilt whenever the data or the width changes.
 */
export function PlotChart(props: {
  data: QueryChartData;
  width: number;
  label: string;
}) {
  const chart = createMemo(() =>
    plotChart(props.data, { width: props.width, palette: CHART_PALETTE })
  );
  const [plot, setPlot] = createSignal<PlotModule>();
  const [failed, setFailed] = createSignal(false);
  onMount(() => {
    void (async () => {
      try {
        setPlot(await loadPlot());
      } catch {
        setFailed(true);
      }
    })();
  });
  let container: HTMLDivElement | undefined;
  // Imperative sync with Plot's returned element; nothing is derived here.
  createEffect(
    on([plot, chart], ([Plot, options]) => {
      if (!Plot || !container) return;
      const element = Plot.plot({
        ...options,
        marks: options.marks.map((mark) => buildMark(Plot, mark)),
      });
      container.replaceChildren(element);
      onCleanup(() => element.remove());
    })
  );
  return (
    <div
      role="img"
      aria-label={props.label}
      aria-busy={!plot() && !failed()}
      class="min-w-0"
      style={plot() ? undefined : { height: `${chart().height}px` }}
    >
      <div ref={container} class="[&_[aria-label=tip]]:text-ink" />
      <Show when={failed()}>
        <p class="py-6 text-center text-xs text-ink-muted">
          The chart could not load. View the data below.
        </p>
      </Show>
    </div>
  );
}
