import { fireAndForget } from '@core/util/fireAndForget';
import type { PlotOptions } from '@observablehq/plot';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type InsightPlotModule = typeof import('@observablehq/plot');

/** Keeps Plot's imperative rendering and lazy loading behind one boundary. */
export function InsightPlot(props: {
  label: string;
  height: number;
  options: (plot: InsightPlotModule, width: number) => PlotOptions;
}) {
  const [frame, setFrame] = createSignal<HTMLDivElement>();
  const size = createElementSize(frame);
  const [plot, setPlot] = createSignal<InsightPlotModule>();
  const [failed, setFailed] = createSignal(false);
  let container: HTMLDivElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  onMount(() => {
    fireAndForget(load(), 'scheduling');
  });
  async function load() {
    try {
      const module = await import('@observablehq/plot');
      if (!disposed) setPlot(module);
    } catch {
      if (!disposed) setFailed(true);
    }
  }
  createEffect(
    on(
      () => {
        const module = plot();
        const width = Math.floor(size.width ?? 0);
        return module && width > 0 ? props.options(module, width) : undefined;
      },
      (options) => {
        if (!options || !container) return;
        const element = plot()!.plot({
          ...options,
          style: {
            fontFamily: 'inherit',
            fontSize: '11px',
            color: 'var(--color-ink-muted)',
            background: 'transparent',
          },
        });
        container.replaceChildren(element);
        onCleanup(() => element.remove());
      }
    )
  );
  return (
    <div
      ref={setFrame}
      role="img"
      data-insight-plot
      aria-label={props.label}
      aria-busy={!plot() && !failed()}
      class="min-w-0 [&_[aria-label=tip]]:text-ink"
      style={{ 'min-height': `${props.height}px` }}
    >
      <div ref={container} />
      <Show when={failed()}>
        <p role="status" class="py-6 text-center text-xs text-ink-muted">
          The chart could not load. View the data below.
        </p>
      </Show>
    </div>
  );
}
