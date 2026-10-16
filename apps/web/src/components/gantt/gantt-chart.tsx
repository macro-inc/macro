import { cn, Scroll } from '@ui';
import {
  createMemo,
  For,
  onCleanup,
  onMount,
  type ParentProps,
} from 'solid-js';
import { createGanttPan } from './create-gantt-pan';
import { GanttCalendarScene } from './gantt-clip';
import { HEADER_HEIGHT, useGantt } from './gantt-context';
import { ganttTicks } from './gantt-date';
import { GanttCursorGuide } from './gantt-markers';

export function GanttChart(
  props: ParentProps<{ class?: string; label?: string }>
) {
  const gantt = useGantt();
  let element: HTMLDivElement | undefined;
  let pointerX: number | undefined;
  let centered = false;
  const pan = createGanttPan({
    viewport: gantt.viewport,
    editing: gantt.editing,
    setEditing: gantt.setEditing,
    clearGuide: () => {
      pointerX = undefined;
      gantt.setGuide(undefined);
    },
    panBy: gantt.panBy,
  });
  const preventMiddleClick = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  };
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
    let unit = 1;
    switch (event.deltaMode) {
      case WheelEvent.DOM_DELTA_LINE:
        unit = 16;
        break;
      case WheelEvent.DOM_DELTA_PAGE:
        unit = element!.clientHeight;
        break;
    }
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
      element.addEventListener('mousedown', pan.start, true);
      element.addEventListener('auxclick', preventMiddleClick, true);
      measure();
    }
    attachment.observe(document, { childList: true, subtree: true });
    connect();
    onCleanup(() => {
      resize.disconnect();
      attachment.disconnect();
      element?.removeEventListener('wheel', zoom);
      element?.removeEventListener('mousedown', pan.start, true);
      element?.removeEventListener('auxclick', preventMiddleClick, true);
      pan.cancel();
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
        class: pan.panning()
          ? 'cursor-grabbing select-none [&_*]:cursor-grabbing'
          : undefined,
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
