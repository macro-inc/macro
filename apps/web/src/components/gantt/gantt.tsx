import { cn } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  untrack,
} from 'solid-js';
import { createGanttToday } from './create-gantt-today';
import { GanttBar } from './gantt-bar';
import { GanttChart } from './gantt-chart';
import {
  GanttContextProvider as Context,
  type GanttContext,
  HEADER_HEIGHT,
} from './gantt-context';
import { GanttCreateArea } from './gantt-create-area';
import {
  type GanttRange,
  type GanttScale,
  ganttPixelsPerDay,
  normalizeGanttRange,
  toGanttDay,
} from './gantt-date';
import { GanttDropPreview } from './gantt-drop-preview';
import {
  GanttDragItem,
  GanttGroupDrag,
  GanttGroupDrop,
} from './gantt-group-drag';
import { GanttHeader } from './gantt-header';
import {
  extendGanttRange,
  type GanttGuide,
  snapGanttGuide,
  zoomedGanttPixels,
} from './gantt-interaction';
import {
  GanttDateHint,
  GanttTodayButton,
  GanttTodayMarker,
} from './gantt-markers';
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
  const today = createGanttToday();
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
    today,
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
    panBy: (deltaX, deltaY) => {
      const element = viewport();
      if (!element) return;
      const current = range();
      const pixels = pixelsPerDay();
      const anchor = current.start + (element.scrollLeft + deltaX) / pixels;
      const days = Math.max(1, element.clientWidth - labelWidth()) / pixels;
      const padding = Math.max(30, Math.ceil(element.clientWidth / pixels));
      // Reserve the desired dates before the browser can clamp the drag distance.
      extendBounds({
        start:
          anchor < current.start ? Math.floor(anchor) - padding : current.start,
        end:
          anchor + days > current.end
            ? Math.ceil(anchor + days) + padding
            : current.end,
      });
      element.scrollLeft = (anchor - range().start) * pixels;
      element.scrollTop += deltaY;
      updateViewport();
    },
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
