import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  splitProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CalendarPageDateInfo } from '../core/page-range';
import { timeGridScroller } from '../utils/time-grid-scroller';
import {
  CalendarGrid,
  type CalendarGridHandle,
  type CalendarGridProps,
} from './CalendarGrid';
import { LightCalendarGrid } from './LightCalendarGrid';

export interface CalendarPageRenderHandle
  extends Omit<CalendarGridHandle, 'dateInfo'> {
  dateInfo: Accessor<CalendarPageDateInfo>;
}

interface CalendarPageRendererProps
  extends Omit<CalendarGridProps, 'initialDate' | 'children'> {
  date: Date;
  now: Date;
  dateInfo: CalendarPageDateInfo;
  interactive: boolean;
  children?: (handle: CalendarPageRenderHandle) => JSX.Element;
}

/** Own the expensive grid only after horizontal motion and date assignment settle. */
export function CalendarPageRenderer(props: CalendarPageRendererProps) {
  const [local, gridProps] = splitProps(props, [
    'date',
    'now',
    'dateInfo',
    'interactive',
    'children',
  ]);
  const [lightElement, setLightElement] = createSignal<HTMLDivElement>();
  const [full, setFull] = createSignal<CalendarGridHandle>();
  const [promotion, setPromotion] = createStore<{
    mounted?: string;
    ready?: string;
  }>({});
  const emptyElements = new Map<string, HTMLElement>();
  const key = () =>
    `${local.date.getTime()}:${local.dateInfo.view.type}:${local.dateInfo.start.getTime()}:${local.dateInfo.end.getTime()}`;
  const request = () => (local.interactive ? key() : undefined);
  const mounted = () => local.interactive && promotion.mounted === key();
  const ready = () => mounted() && promotion.ready === key();

  // Settlement can immediately dispatch another queued command. Delay mounting
  // one frame and recheck the request so transient idle states never build a grid.
  createEffect(
    on(request, (requested) => {
      setPromotion({ mounted: undefined, ready: undefined });
      if (!requested) return;
      const frame = requestAnimationFrame(() => {
        if (request() !== requested) return;
        const span = Telemetry.span('calendar.page.promote', {
          sampling: 'perf',
        });
        span.setAttr('calendar.view', local.dateInfo.view.type);
        try {
          span.run(() => setPromotion('mounted', requested));
        } finally {
          span.end();
        }
      });
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );

  const handle: CalendarPageRenderHandle = {
    element: () => (ready() ? full()?.element() : lightElement()),
    api: () => (ready() ? full()?.api() : undefined),
    dateInfo: () => local.dateInfo,
    get eventElements() {
      return ready() ? (full()?.eventElements ?? emptyElements) : emptyElements;
    },
    chipMounts: () => {
      full()?.chipMounts();
      return undefined;
    },
  };

  function InteractiveReady(child: { grid: CalendarGridHandle }) {
    setFull(child.grid);
    onCleanup(() => setFull(undefined));
    createEffect(
      on(
        () => [child.grid.api(), child.grid.dateInfo()] as const,
        ([api, info]) => {
          if (!api || !info) return;
          const expected = key();
          const frame = requestAnimationFrame(() => {
            if (!mounted() || key() !== expected) return;
            const scroller = timeGridScroller(child.grid.element());
            if (scroller && props.initialScrollTop !== undefined)
              scroller.scrollTop = props.initialScrollTop;
            setPromotion('ready', expected);
          });
          onCleanup(() => cancelAnimationFrame(frame));
        }
      )
    );
    return null;
  }

  return (
    <div
      class="relative size-full min-h-0 min-w-0"
      data-calendar-renderer={ready() ? 'interactive' : 'light'}
    >
      <Show when={!ready()}>
        <LightCalendarGrid
          date={local.date}
          now={local.now}
          onElement={setLightElement}
          dateInfo={local.dateInfo}
          events={gridProps.events}
          settings={gridProps.settings}
          initialScrollTop={gridProps.initialScrollTop}
          selectedEventId={gridProps.selection.eventId}
          draftRange={gridProps.dayDraft?.range()}
          selectionColor={gridProps.selection.color}
        />
      </Show>
      <Show when={mounted()}>
        <div
          class="absolute inset-0"
          style={{
            visibility: ready() ? 'visible' : 'hidden',
            'pointer-events': ready() ? undefined : 'none',
          }}
        >
          <CalendarGrid {...gridProps} initialDate={local.date}>
            {(grid) => <InteractiveReady grid={grid} />}
          </CalendarGrid>
        </div>
      </Show>
      {local.children?.(handle)}
    </div>
  );
}
