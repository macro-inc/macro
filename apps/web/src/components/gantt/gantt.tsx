import { Key } from '@solid-primitives/keyed';
import { Button, cn, Scroll } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { GanttBar } from './gantt-bar';
import { GanttCalendarScene } from './gantt-clip';
import {
  GanttContextProvider as Context,
  type GanttContext,
  HEADER_HEIGHT,
  useGantt,
} from './gantt-context';
import { GanttCreateArea } from './gantt-create-area';
import {
  formatGanttDay,
  formatGanttMonth,
  type GanttDate,
  type GanttRange,
  type GanttScale,
  type GanttTick,
  ganttBarGeometry,
  ganttDateFromDay,
  ganttPixelsPerDay,
  ganttTicks,
  normalizeGanttRange,
  toGanttDay,
} from './gantt-date';
import { GanttDropPreview } from './gantt-drop-preview';
import {
  GanttDragItem,
  GanttGroupDrag,
  GanttGroupDrop,
} from './gantt-group-drag';
import {
  extendGanttRange,
  type GanttGuide,
  snapGanttGuide,
  zoomedGanttPixels,
} from './gantt-interaction';
import { GanttRow, GanttRows } from './gantt-rows';
import { GanttSettings } from './gantt-settings';
import {
  GanttControls,
  GanttGroupHeader,
  GanttLabel,
  GanttPagination,
  GanttSidebarToggle,
} from './gantt-sidebar';
import { GanttZoomControls } from './gantt-zoom-controls';

export { useGantt } from './gantt-context';
export { GanttLabel } from './gantt-sidebar';

const SIDEBAR_COLLAPSE_WIDTH = 640;
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
  const [sidebarChoice, setSidebarChoice] = createSignal<boolean>();
  let sidebarTrigger: HTMLButtonElement | undefined;
  const [scrollZooming, setScrollZooming] = createSignal(false);
  let scrollZoomTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(scrollZoomTimeout));
  let extending = false;
  let scrollRevision = 0;
  const [metrics, setMetrics] = createSignal({
    left: 0,
    width: 1_000,
    start: dataRange().start,
    pixels: ganttPixelsPerDay(props.defaultScale ?? 'week'),
  });
  const rowHeight = () => props.rowHeight ?? 40;
  // Scroll changes do not resize the calendar; zoom, bounds, and viewport changes do.
  const viewportWidth = createMemo(() => metrics().width);
  const labelWidth = () => {
    if (props.labelWidth !== undefined) return props.labelWidth;
    const available = viewportWidth() || 1_000;
    return Math.min(260, Math.max(128, available * 0.3), available / 2);
  };
  const sidebarWidth = () => Math.min(280, Math.max(0, viewportWidth() - 40));
  const sidebarOpen = () =>
    labelWidth() === 0 &&
    (sidebarChoice() ?? (viewportWidth() || 1_000) >= SIDEBAR_COLLAPSE_WIDTH);
  const restoreSidebarFocus = () => {
    const focused = document.activeElement;
    if (
      viewport()?.contains(focused) &&
      focused instanceof Element &&
      focused.closest('[data-gantt-label]')
    ) {
      sidebarTrigger?.focus({ preventScroll: true });
    }
  };
  const changeSidebar = (open: boolean) => {
    if (open && editing()) return;
    if (!open) restoreSidebarFocus();
    setGuide(undefined);
    setSidebarChoice(open);
  };
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
    const wasOpen = sidebarOpen();
    if (
      sidebarChoice() === undefined &&
      wasOpen &&
      element.clientWidth > 0 &&
      element.clientWidth < SIDEBAR_COLLAPSE_WIDTH
    ) {
      restoreSidebarFocus();
    }
    setMetrics({
      left: element.scrollLeft,
      width: element.clientWidth,
      start: range().start,
      pixels: pixelsPerDay(),
    });
    if (wasOpen !== sidebarOpen()) setGuide(undefined);
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
    if (next) extendBounds(next);
  };
  function extendBounds(next: GanttRange) {
    const element = viewport();
    const current = range();
    if (!element || (next.start === current.start && next.end === current.end))
      return;
    const left = element.scrollLeft;
    const pixels = pixelsPerDay();
    extending = true;
    ++scrollRevision;
    try {
      // Commit the new DOM width before compensating, or the browser clamps the offset.
      setExtent(next);
      if (range().start !== current.start) {
        element.scrollLeft = left + (current.start - range().start) * pixels;
      }
      updateViewport();
    } finally {
      extending = false;
    }
  }
  const visibleRange = () => {
    const current = metrics();
    const start = current.start + current.left / current.pixels;
    return {
      start,
      end: start + Math.max(1, current.width - labelWidth()) / pixelsPerDay(),
    };
  };

  function restoreScroll(anchor: number, behavior: ScrollBehavior = 'instant') {
    const element = viewport();
    if (!element) return;
    const revision = ++scrollRevision;
    queueMicrotask(() => {
      if (viewport() !== element || revision !== scrollRevision) return;
      const left = Math.max(0, (anchor - range().start) * pixelsPerDay());
      const reducedMotion = window.matchMedia?.(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      if (behavior === 'smooth' && !reducedMotion) {
        element.scrollTo({ left, behavior });
      } else {
        element.scrollLeft = left;
      }
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
    scrollZooming,
    markScrollZoom: () => {
      if (editing()) return;
      clearTimeout(scrollZoomTimeout);
      setScrollZooming(true);
      scrollZoomTimeout = setTimeout(() => setScrollZooming(false), 800);
    },
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
    sidebar: {
      open: sidebarOpen,
      width: sidebarWidth,
      setOpen: changeSidebar,
      setTrigger: (element) => {
        sidebarTrigger = element;
      },
    },
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
      if (x < labelWidth() || (sidebarOpen() && x < sidebarWidth())) return;
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
    scrollToToday: (behavior = 'smooth') => {
      const element = viewport();
      const today = toGanttDay(new Date());
      if (!element || today === undefined) return;
      const pixels = pixelsPerDay();
      const days = Math.max(1, element.clientWidth - labelWidth()) / pixels;
      const anchor = range().start + element.scrollLeft / pixels;
      const destination = today + 0.5 - days / 2;
      const padding = Math.max(30, Math.ceil(element.clientWidth / pixels));
      const current = range();
      // Reserve the complete animation path so no edge rebase interrupts smooth scrolling.
      extendBounds({
        start: Math.min(
          current.start,
          Math.floor(Math.min(anchor, destination) - padding)
        ),
        end: Math.max(
          current.end,
          Math.ceil(Math.max(anchor, destination) + days + padding)
        ),
      });
      restoreScroll(destination, behavior);
    },
  };

  return (
    <Context.Provider value={context}>
      <div
        class={cn(
          'relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden',
          props.class
        )}
        onKeyDown={(event) => {
          if (
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            editing() ||
            !sidebarOpen()
          )
            return;
          event.preventDefault();
          changeSidebar(false);
        }}
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
          class="pointer-events-none absolute bottom-1 z-30 overflow-hidden rounded border border-edge-muted bg-tooltip px-1.5 py-0.5 text-xxs text-ink whitespace-nowrap"
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
    <Button
      depth={2}
      size="md"
      variant="outline"
      class="bg-surface shadow-sm"
      onClick={() => gantt.scrollToToday()}
    >
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
      if (gantt.viewport() === element) gantt.scrollToToday('instant');
    });
  };
  const zoom = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      // Wheel events continue at a clamped edge even when no scroll event fires.
      gantt.updateViewport();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (
      event.target instanceof Element &&
      event.target.closest('[data-gantt-label]')
    )
      return;
    if (gantt.editing()) return;
    gantt.markScrollZoom();
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
        style: { 'overscroll-behavior': 'none', 'overflow-anchor': 'none' },
        onScroll: () => {
          gantt.updateViewport();
          updateGuide();
        },
        onPointerMove: (event) => {
          if (
            event.target.closest(
              '[data-gantt-label], [data-gantt-group-header]'
            )
          ) {
            pointerX = undefined;
            gantt.setGuide(undefined);
            return;
          }
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
    ganttTicks(gantt.range(), 'month', gantt.visibleRange()).map((tick) => ({
      ...tick,
      label: formatGanttMonth(
        tick.start,
        gantt.scale() === 'month' ? 'short' : 'long'
      ),
    }))
  );
  const ticks = createMemo(() =>
    ganttTicks(gantt.range(), gantt.scale(), gantt.visibleRange())
  );
  const left = (day: number) =>
    (day - gantt.range().start) * gantt.pixelsPerDay();
  const calendarWidth = () =>
    (gantt.visibleRange().end - gantt.visibleRange().start) *
    gantt.pixelsPerDay();
  // The drawer starts below the header; reserve only its toggle in the timeline band.
  const textInset = () =>
    gantt.labelWidth() > 0 ? gantt.labelWidth() + 8 : 64;
  const pinnedMonthLeft = () =>
    left(gantt.visibleRange().start) + textInset() - gantt.labelWidth();
  const monthYear = (tick: GanttTick) => {
    const date = ganttDateFromDay(tick.start);
    return date.getMonth() === 0 || left(tick.start) + 4 <= pinnedMonthLeft()
      ? date.getFullYear()
      : undefined;
  };
  const monthLabelWidth = (tick: GanttTick) =>
    tick.label.length * 7 + (monthYear(tick) === undefined ? 8 : 44);
  const monthLeft = (tick: GanttTick) =>
    Math.min(
      Math.max(left(tick.start) + 4, pinnedMonthLeft()),
      left(tick.end) - monthLabelWidth(tick)
    );
  const monthOpacity = (tick: GanttTick) =>
    Math.max(0, 1 - Math.max(0, pinnedMonthLeft() - monthLeft(tick)) / 32);
  return (
    <div
      class={cn(
        'sticky top-0 z-30 flex border-b border-edge-muted bg-panel text-xs text-ink-muted',
        props.class
      )}
      data-gantt-header=""
      style={{ height: `${HEADER_HEIGHT}px`, width: `${gantt.width()}px` }}
    >
      <Show when={gantt.labelWidth() > 0}>
        <div
          class="sticky left-0 z-10 flex shrink-0 flex-wrap content-center items-center justify-between gap-x-2 gap-y-1 border-r border-edge-muted bg-inherit px-3 font-medium text-ink"
          style={{ width: `${gantt.labelWidth()}px` }}
        >
          {props.children}
        </div>
      </Show>
      <div class="relative isolate flex-1 overflow-clip">
        <TodayLine header />
        <For each={ticks()}>
          {(tick) => (
            <div
              data-gantt-date-tick=""
              class="absolute inset-y-0 flex items-center leading-4 whitespace-nowrap"
              style={{ left: `${left(tick.start)}px` }}
            >
              <span class="relative h-4 -translate-x-1/2">
                <Show
                  when={
                    gantt.scale() !== 'month' &&
                    !months().some((month) => {
                      const distance = left(tick.start) - monthLeft(month);
                      const halfLabel = tick.label.length * 3 + 4;
                      return (
                        monthOpacity(month) > 0 &&
                        distance > -halfLabel &&
                        distance < monthLabelWidth(month) + halfLabel
                      );
                    })
                  }
                >
                  {tick.label}
                </Show>
                <span
                  aria-hidden="true"
                  data-gantt-date-mark=""
                  class="absolute top-full left-1/2 mt-1 h-1.5 w-px -translate-x-1/2 bg-ink-extra-muted/70"
                />
              </span>
            </div>
          )}
        </For>
        <Key each={months()} by="start">
          {(tick) => (
            <div
              data-gantt-month=""
              class="pointer-events-none absolute inset-y-0 flex items-center overflow-clip text-ink whitespace-nowrap"
              style={{
                left: `${left(tick().start)}px`,
                width: `${(tick().end - tick().start) * gantt.pixelsPerDay()}px`,
              }}
            >
              <span
                class="sticky z-20 ml-1 flex shrink-0 items-baseline gap-2 bg-panel px-1 text-xs leading-4"
                style={{
                  left: `${textInset()}px`,
                  opacity: monthOpacity(tick()),
                }}
              >
                <span class="font-semibold">{tick().label}</span>
                <Show when={monthYear(tick()) !== undefined}>
                  <span
                    data-gantt-year=""
                    class="font-medium text-ink tabular-nums"
                  >
                    {monthYear(tick())}
                  </span>
                </Show>
              </span>
            </div>
          )}
        </Key>
        <div
          aria-hidden="true"
          data-gantt-timeline-fades=""
          class="pointer-events-none absolute inset-0 z-10"
        >
          <div
            class="sticky h-full"
            style={{
              left: `${gantt.labelWidth()}px`,
              width: `${calendarWidth()}px`,
            }}
          >
            <div class="absolute inset-y-0 left-0 w-[min(128px,33%)] bg-gradient-to-r from-panel to-transparent" />
            <div class="absolute inset-y-0 right-0 w-[min(128px,33%)] bg-gradient-to-l from-panel to-transparent" />
          </div>
        </div>
        <Show when={gantt.labelWidth() === 0}>
          <div class="pointer-events-none absolute inset-0 z-30">
            <div
              data-gantt-toggle-mask=""
              class="sticky left-0 h-full w-14 bg-panel"
            />
          </div>
        </Show>
        <GanttCursorTooltip />
      </div>
    </div>
  );
}

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
  SidebarToggle: GanttSidebarToggle,
  Controls: GanttControls,
  Pagination: GanttPagination,
  ZoomControls: GanttZoomControls,
  Chart: GanttChart,
  Header: GanttHeader,
  Rows: GanttRows,
  Row: GanttRow,
  GroupDrag: GanttGroupDrag,
  DragItem: GanttDragItem,
  GroupDrop: GanttGroupDrop,
  DropPreview: GanttDropPreview,
  GroupHeader: GanttGroupHeader,
  Label: GanttLabel,
  DateHint: GanttDateHint,
  CreateArea: GanttCreateArea,
  Bar: GanttBar,
  TodayMarker: GanttTodayMarker,
};
