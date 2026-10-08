import { Key } from '@solid-primitives/keyed';
import {
  createVirtualizer,
  defaultRangeExtractor,
  type Range,
} from '@tanstack/solid-virtual';
import { Button, cn, Scroll } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  splitProps,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { GanttBar } from './gantt-bar';
import { GanttCalendarScene } from './gantt-clip';
import {
  GanttContextProvider as Context,
  type GanttContext,
  HEADER_HEIGHT,
  MONTH_HEADER_HEIGHT,
  useGantt,
} from './gantt-context';
import { GanttCreateArea } from './gantt-create-area';
import {
  formatGanttDay,
  type GanttDate,
  type GanttRange,
  type GanttScale,
  ganttBarGeometry,
  ganttPixelsPerDay,
  ganttTicks,
  normalizeGanttRange,
  toGanttDay,
} from './gantt-date';
import {
  extendGanttRange,
  type GanttGuide,
  snapGanttGuide,
  zoomedGanttPixels,
} from './gantt-interaction';
import { GanttSettings } from './gantt-settings';

export { useGantt } from './gantt-context';

export function GanttRoot(
  props: ParentProps<{
    range: GanttRange;
    defaultScale?: GanttScale;
    labelWidth?: number;
    rowHeight?: number;
    class?: string;
  }>
) {
  const dataRange = createMemo(
    () => normalizeGanttRange(props.range),
    undefined,
    {
      equals: (left, right) =>
        left.start === right.start && left.end === right.end,
    }
  );
  const [pixelsPerDay, setPixelsPerDay] = createSignal(
    ganttPixelsPerDay(props.defaultScale ?? 'week')
  );
  const scale = (): GanttScale =>
    pixelsPerDay() >= 32 ? 'day' : pixelsPerDay() >= 12 ? 'week' : 'month';
  const [gridVisible, setGridVisible] = createSignal(true);
  const [gridScale, setGridScale] = createSignal<GanttScale>(
    props.defaultScale ?? 'week'
  );
  const [gridStyle, setGridStyle] = createSignal<'solid' | 'dashed'>('solid');
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [extent, setExtent] = createSignal<GanttRange>();
  const [guide, setGuide] = createSignal<GanttGuide>();
  const [editing, setEditing] = createSignal(false);
  let extending = false;
  let scrollRevision = 0;
  const [metrics, setMetrics] = createSignal({
    left: 0,
    width: 1_000,
    start: dataRange().start,
    pixels: ganttPixelsPerDay(props.defaultScale ?? 'week'),
  });
  const labelWidth = () => props.labelWidth ?? 260;
  const rowHeight = () => props.rowHeight ?? 44;
  // Scroll changes do not resize the calendar; zoom, bounds, and viewport changes do.
  const viewportWidth = createMemo(() => metrics().width);
  const range = createMemo(() => {
    const data = dataRange();
    const extended = extent();
    const bounds = {
      start: Math.min(data.start, extended?.start ?? data.start),
      end: Math.max(data.end, extended?.end ?? data.end),
    };
    const days = Math.max(1, viewportWidth() - labelWidth()) / pixelsPerDay();
    const previous = untrack(metrics);
    const anchor = previous.start + previous.left / previous.pixels;
    return {
      start: bounds.start,
      end: Math.max(
        bounds.end,
        Math.ceil(Math.max(bounds.start, anchor) + days)
      ),
    };
  });
  const width = () =>
    labelWidth() + (range().end - range().start) * pixelsPerDay();
  const updateViewport = () => {
    const element = viewport();
    if (!element) return;
    setMetrics({
      left: element.scrollLeft,
      width: element.clientWidth,
      start: range().start,
      pixels: pixelsPerDay(),
    });
    extendViewport();
  };
  const extendViewport = () => {
    const element = viewport();
    if (
      !element ||
      extending ||
      !element.clientWidth ||
      Math.abs(element.scrollWidth - width()) > 1
    )
      return;
    const next = extendGanttRange(
      range(),
      element.scrollLeft,
      element.clientWidth,
      element.scrollWidth,
      pixelsPerDay()
    );
    if (!next) return;
    extending = true;
    const anchor = metrics().start + metrics().left / metrics().pixels;
    setExtent(next);
    queueMicrotask(() => {
      if (viewport() === element) {
        element.scrollLeft = Math.max(
          0,
          (anchor - range().start) * pixelsPerDay()
        );
        updateViewport();
      }
      extending = false;
    });
  };
  const visibleRange = () => ({
    start: range().start + metrics().left / pixelsPerDay(),
    end:
      range().start +
      (metrics().left + Math.max(1, metrics().width - labelWidth())) /
        pixelsPerDay(),
  });

  function restoreScroll(anchor: number) {
    const element = viewport();
    if (!element) return;
    const revision = ++scrollRevision;
    queueMicrotask(() => {
      if (viewport() !== element || revision !== scrollRevision) return;
      element.scrollLeft = Math.max(
        0,
        (anchor - range().start) * pixelsPerDay()
      );
      updateViewport();
    });
  }
  // Preserve the visible calendar position when zooming or loading older items.
  createEffect(
    on(
      () => [range().start, pixelsPerDay()] as const,
      (_, previous) => {
        if (!viewport() || !previous || extending) return;
        const current = metrics();
        restoreScroll(current.start + current.left / current.pixels);
      }
    )
  );

  const context: GanttContext = {
    range,
    scale,
    setScale: (value) => setPixelsPerDay(ganttPixelsPerDay(value)),
    pixelsPerDay,
    zoomAt: (clientX, delta) => {
      const element = viewport();
      if (!element || extending || editing() || !Number.isFinite(delta)) return;
      const next = zoomedGanttPixels(pixelsPerDay(), delta);
      if (next === pixelsPerDay()) return;
      const offset = Math.max(
        0,
        Math.min(
          clientX - element.getBoundingClientRect().left - labelWidth(),
          element.clientWidth - labelWidth()
        )
      );
      const current = metrics();
      const first = current.start + current.left / current.pixels;
      const anchor = first + offset / pixelsPerDay() - offset / next;
      const currentRange = range();
      const start =
        anchor < currentRange.start
          ? Math.floor(anchor) - Math.ceil(element.clientWidth / next)
          : currentRange.start;
      // Keep logical metrics current for consecutive wheel events before DOM synchronization.
      batch(() => {
        if (start < currentRange.start) {
          setExtent({ start, end: currentRange.end });
        }
        setMetrics({
          ...current,
          left: Math.max(0, (anchor - start) * next),
          start,
          pixels: next,
        });
        setPixelsPerDay(next);
      });
    },
    gridVisible,
    setGridVisible,
    gridScale,
    setGridScale,
    gridStyle,
    setGridStyle,
    labelWidth,
    rowHeight,
    width,
    visibleRange,
    viewport,
    setViewport,
    updateViewport,
    guide,
    setGuide,
    editing,
    setEditing,
    pointToDay: (clientX, exclude, snap = true) => {
      const element = viewport();
      if (!element || extending) return;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left;
      if (x < labelWidth()) return;
      const day =
        range().start +
        (element.scrollLeft + Math.min(x, rect.width) - labelWidth()) /
          pixelsPerDay();
      if (!snap) return { day };
      const targets = [
        ...element.querySelectorAll<HTMLElement>('[data-gantt-bar]'),
      ].flatMap((bar) => {
        if (bar === exclude) return [];
        const box = bar.getBoundingClientRect();
        if (box.bottom <= rect.top + HEADER_HEIGHT || box.top >= rect.bottom)
          return [];
        const start = Number(bar.dataset.ganttStart);
        const end =
          bar.dataset.ganttEnd === undefined
            ? undefined
            : Number(bar.dataset.ganttEnd);
        return Number.isFinite(start) ? [{ start, end }] : [];
      });
      return snapGanttGuide(day, pixelsPerDay(), targets);
    },
    scrollToToday: () => {
      const element = viewport();
      const today = toGanttDay(new Date());
      if (!element || today === undefined) return;
      const half =
        Math.max(1, element.clientWidth - labelWidth()) / pixelsPerDay() / 2;
      const center = today + 0.5;
      const current = range();
      if (center - half < current.start || center + half > current.end) {
        setExtent({
          start: Math.min(current.start, Math.floor(center - half - 1)),
          end: Math.max(current.end, Math.ceil(center + half + 1)),
        });
      }
      restoreScroll(center - half);
    },
  };

  return (
    <Context.Provider value={context}>
      <div
        class={cn(
          'flex size-full min-h-0 min-w-0 flex-col overflow-hidden',
          props.class
        )}
      >
        {props.children}
      </div>
    </Context.Provider>
  );
}

function GanttCursorGuide() {
  const gantt = useGantt();
  return (
    <Show when={!gantt.editing() && gantt.guide()}>
      {(guide) => (
        <GanttCalendarScene class="z-20">
          <div
            data-gantt-cursor-line=""
            class="absolute inset-y-0 border-l border-dashed border-ink-muted opacity-70"
            style={{
              left: `${gantt.labelWidth() + (guide().day - gantt.range().start) * gantt.pixelsPerDay()}px`,
            }}
          />
        </GanttCalendarScene>
      )}
    </Show>
  );
}

function GanttCursorTooltip() {
  const gantt = useGantt();
  return (
    <Show when={!gantt.editing() && gantt.guide()}>
      {(guide) => (
        <span
          data-gantt-cursor-label=""
          class="pointer-events-none absolute bottom-1 z-10 overflow-hidden rounded border border-edge-muted bg-tooltip px-1.5 py-0.5 text-xxs text-ink whitespace-nowrap"
          style={{
            left: `${(guide().day - gantt.range().start) * gantt.pixelsPerDay()}px`,
            'max-width': `${Math.max(0, (gantt.visibleRange().end - gantt.visibleRange().start) * gantt.pixelsPerDay() - 16)}px`,
            translate: `clamp(${(gantt.visibleRange().start - guide().day) * gantt.pixelsPerDay() + 8}px, -50%, calc(${(gantt.visibleRange().end - guide().day) * gantt.pixelsPerDay() - 8}px - 100%)) 0`,
          }}
        >
          {formatGanttDay(
            guide().edge === 'end' ? guide().day - 1 : Math.floor(guide().day),
            false
          )}
        </span>
      )}
    </Show>
  );
}
export function GanttTodayButton() {
  const gantt = useGantt();
  return (
    <Button size="sm" variant="ghost" onClick={gantt.scrollToToday}>
      Today
    </Button>
  );
}

export function GanttChart(
  props: ParentProps<{ class?: string; label?: string }>
) {
  const gantt = useGantt();
  let element: HTMLDivElement | undefined;
  let pointerX: number | undefined;
  let centered = false;
  const measure = () => {
    gantt.updateViewport();
    if (centered || !element?.clientWidth) return;
    centered = true;
    queueMicrotask(() => {
      if (gantt.viewport() === element) gantt.scrollToToday();
    });
  };
  const zoom = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element!.clientHeight
          : 1;
    gantt.zoomAt(event.clientX, event.deltaY * unit);
    updateGuide();
  };
  const updateGuide = () =>
    queueMicrotask(() => {
      if (
        pointerX === undefined ||
        gantt.editing() ||
        gantt.viewport() !== element
      )
        return;
      gantt.setGuide(gantt.pointToDay(pointerX));
    });
  onMount(() => {
    const resize = new ResizeObserver(measure);
    const attachment = new MutationObserver(connect);
    function connect() {
      if (!element?.isConnected) return;
      attachment.disconnect();
      gantt.setViewport(element);
      resize.observe(element);
      element.addEventListener('wheel', zoom, { passive: false });
      measure();
    }
    attachment.observe(document, { childList: true, subtree: true });
    connect();
    onCleanup(() => {
      resize.disconnect();
      attachment.disconnect();
      element?.removeEventListener('wheel', zoom);
      if (gantt.viewport() === element) gantt.setViewport(undefined);
    });
  });
  return (
    <Scroll
      class={cn('min-h-0 min-w-0 flex-1', props.class)}
      orientation="both"
      scrollbars="both"
      autoHide={false}
      verticalScrollbarInset={HEADER_HEIGHT}
      scrollRef={(viewport) => {
        element = viewport;
      }}
      viewportProps={{
        'aria-label': props.label ?? 'Gantt timeline',
        tabIndex: 0,
        onScroll: () => {
          gantt.updateViewport();
          updateGuide();
        },
        onPointerMove: (event) => {
          pointerX = event.clientX;
          if (gantt.editing()) return;
          gantt.setGuide(gantt.pointToDay(event.clientX));
        },
        onPointerLeave: () => {
          pointerX = undefined;
          if (!gantt.editing()) gantt.setGuide(undefined);
        },
      }}
      contentProps={{
        style: {
          position: 'relative',
          isolation: 'isolate',
          width: `${gantt.width()}px`,
          'min-height': '100%',
          'padding-bottom': '32px',
        },
      }}
    >
      <GridLines />
      <GanttCursorGuide />
      {props.children}
    </Scroll>
  );
}

export function GanttHeader(props: ParentProps<{ class?: string }>) {
  const gantt = useGantt();
  const months = createMemo(() =>
    ganttTicks(gantt.range(), 'month', gantt.visibleRange())
  );
  const ticks = createMemo(() =>
    ganttTicks(gantt.range(), gantt.scale(), gantt.visibleRange())
  );
  const left = (day: number) =>
    (day - gantt.range().start) * gantt.pixelsPerDay();
  return (
    <div
      class={cn(
        'sticky top-0 z-30 flex border-b border-edge-muted bg-panel text-xs text-ink-muted',
        props.class
      )}
      data-gantt-header=""
      style={{ height: `${HEADER_HEIGHT}px`, width: `${gantt.width()}px` }}
    >
      <div
        class="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-2 border-r border-edge-muted bg-inherit px-4 font-medium text-ink"
        style={{ width: `${gantt.labelWidth()}px` }}
      >
        {props.children}
      </div>
      <div class="relative isolate flex-1 overflow-hidden">
        <TodayLine header />
        <For each={months()}>
          {(tick) => (
            <div
              class="absolute top-0 flex items-center overflow-hidden border-l border-edge-muted whitespace-nowrap"
              style={{
                height:
                  gantt.scale() === 'month'
                    ? `${HEADER_HEIGHT}px`
                    : `${MONTH_HEADER_HEIGHT}px`,
                left: `${left(tick.start)}px`,
                width: `${(tick.end - tick.start) * gantt.pixelsPerDay()}px`,
              }}
            >
              <span class="px-2 text-lg font-bold text-ink">{tick.label}</span>
            </div>
          )}
        </For>
        <Show when={gantt.scale() !== 'month'}>
          <For each={ticks()}>
            {(tick) => (
              <div
                class="absolute flex h-7 items-center overflow-hidden border-l border-edge-muted px-2 whitespace-nowrap"
                style={{
                  top: `${MONTH_HEADER_HEIGHT}px`,
                  left: `${left(tick.start)}px`,
                  width: `${(tick.end - tick.start) * gantt.pixelsPerDay()}px`,
                }}
              >
                {tick.label}
              </div>
            )}
          </For>
        </Show>
        <GanttCursorTooltip />
      </div>
    </div>
  );
}

type RowsProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string | number;
  virtualize?: boolean;
  children: (item: T) => JSX.Element;
};

function GridLines() {
  const gantt = useGantt();
  const ticks = createMemo(() =>
    gantt.gridVisible()
      ? ganttTicks(gantt.range(), gantt.gridScale(), gantt.visibleRange())
      : []
  );
  return (
    <GanttCalendarScene>
      <For each={ticks()}>
        {(tick) => (
          <div
            class={cn(
              'absolute inset-y-0 border-l border-edge-muted/60',
              gantt.gridStyle() === 'dashed' && 'border-dashed'
            )}
            style={{
              left: `${gantt.labelWidth() + (tick.start - gantt.range().start) * gantt.pixelsPerDay()}px`,
            }}
          />
        )}
      </For>
    </GanttCalendarScene>
  );
}

function VirtualRows<T>(props: RowsProps<T>) {
  const gantt = useGantt();
  const [focusedKey, setFocusedKey] = createSignal<string | number>();
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.items.length;
    },
    get getItemKey() {
      const keys = props.items.map(props.getKey);
      return (index: number) => keys[index];
    },
    getScrollElement: () => gantt.viewport() ?? null,
    estimateSize: () => gantt.rowHeight(),
    scrollMargin: HEADER_HEIGHT,
    overscan: 8,
    get rangeExtractor() {
      const key = focusedKey();
      const pinned =
        key === undefined
          ? -1
          : props.items.findIndex((item) => props.getKey(item) === key);
      return (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return pinned < 0 || indexes.includes(pinned)
          ? indexes
          : [...indexes, pinned].sort((a, b) => a - b);
      };
    },
  });
  createEffect(
    on(gantt.rowHeight, () => virtualizer.measure(), { defer: true })
  );
  return (
    <div
      class="relative"
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: `${gantt.width()}px`,
      }}
      onFocusIn={(event) => {
        const row = event.target.closest<HTMLElement>('[data-gantt-row-index]');
        const index = Number(row?.dataset.ganttRowIndex);
        const item = props.items[index];
        if (item !== undefined) setFocusedKey(props.getKey(item));
      }}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setFocusedKey(undefined);
      }}
    >
      <Key each={virtualizer.getVirtualItems()} by="key">
        {(virtualRow) => (
          <div
            data-gantt-row-index={virtualRow().index}
            class="absolute left-0"
            style={{ top: `${virtualRow().start - HEADER_HEIGHT}px` }}
          >
            <For
              each={props.items.slice(
                virtualRow().index,
                virtualRow().index + 1
              )}
            >
              {(item) => props.children(item)}
            </For>
          </div>
        )}
      </Key>
    </div>
  );
}

/** Only this slot chooses virtualization; consumers keep ownership of their data and rows. */
export function GanttRows<T>(props: RowsProps<T>) {
  return (
    <Show
      when={props.virtualize}
      fallback={
        <div class="relative">
          {/* Keep occurrence keys, but refresh the renderer when an immutable item is replaced. */}
          <Key each={props.items} by={props.getKey}>
            {(item) => (
              <For each={[item()]}>{(current) => props.children(current)}</For>
            )}
          </Key>
        </div>
      }
    >
      <VirtualRows {...props} />
    </Show>
  );
}

export function GanttRow(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'group/gantt-row relative border-b border-edge-muted/60 text-sm text-ink hover:bg-hover focus-within:bg-hover',
        local.class
      )}
      style={{ width: `${gantt.width()}px`, height: `${gantt.rowHeight()}px` }}
    >
      {local.children}
    </div>
  );
}

export function GanttLabel(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'sticky left-0 z-20 flex h-full items-center border-r border-edge-muted px-4 py-1.5 group-hover/gantt-row:bg-hover group-focus-within/gantt-row:bg-hover',
        local.class
      )}
      data-gantt-label=""
      style={{ width: `${gantt.labelWidth()}px` }}
    >
      {local.children}
    </div>
  );
}

/** Compose inside Gantt.Label so invalid-date explanations remain visible while scrolling. */
export function GanttDateHint(props: {
  start: GanttDate;
  end?: GanttDate;
  class?: string;
}) {
  const gantt = useGantt();
  const problem = () =>
    match(ganttBarGeometry(props, gantt.range(), gantt.pixelsPerDay()).kind)
      .with('missing-start', () => 'No start date')
      .with('invalid-start', () => 'Invalid start date')
      .with('invalid-end', () => 'Invalid end date')
      .with('reversed', () => 'End date precedes start')
      .otherwise(() => '');
  return (
    <Show when={problem()}>
      <span
        class={cn('block truncate text-xxs text-ink-muted', props.class)}
        title={problem()}
      >
        {problem()}
      </span>
    </Show>
  );
}

function TodayLine(props: { date?: GanttDate; header?: boolean }) {
  const gantt = useGantt();
  const day = () => toGanttDay(props.date ?? new Date());
  const visible = () => {
    const current = day();
    return (
      current !== undefined &&
      current + 0.5 >= gantt.visibleRange().start &&
      current + 0.5 < gantt.visibleRange().end
    );
  };
  const marker = () => (
    <div
      aria-hidden="true"
      data-gantt-today={props.header ? 'header' : 'body'}
      class="pointer-events-none absolute inset-y-0 z-0 w-px bg-ink-muted/60"
      style={{
        left: `${(props.header ? 0 : gantt.labelWidth()) + (day()! - gantt.range().start + 0.5) * gantt.pixelsPerDay()}px`,
      }}
    />
  );
  return (
    <Show when={visible()}>
      <Show
        when={props.header}
        fallback={
          <GanttCalendarScene class="z-0">{marker()}</GanttCalendarScene>
        }
      >
        {marker()}
      </Show>
    </Show>
  );
}
export function GanttTodayMarker(props: { date?: GanttDate }) {
  return <TodayLine date={props.date} />;
}

export const Gantt = {
  Root: GanttRoot,
  TodayButton: GanttTodayButton,
  Settings: GanttSettings,
  Chart: GanttChart,
  Header: GanttHeader,
  Rows: GanttRows,
  Row: GanttRow,
  Label: GanttLabel,
  DateHint: GanttDateHint,
  CreateArea: GanttCreateArea,
  Bar: GanttBar,
  TodayMarker: GanttTodayMarker,
};
