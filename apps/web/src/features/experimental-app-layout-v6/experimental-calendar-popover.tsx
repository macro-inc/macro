import { CALENDAR_BLOCK_ID } from '@app/features/block-calendar/types';
import type { CalendarGridHandle } from '@app/features/calendar/components/CalendarGrid';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import {
  CalendarViewContextProvider,
  useCalendarView,
} from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import { Popover } from '@kobalte/core/popover';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Button, cn, Surface } from '@ui';
import {
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  type Setter,
  Suspense,
} from 'solid-js';
import { ExperimentalPopoverSplitAction } from './experimental-popover-split-action';

const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});

const CalendarEmbed = lazy(() =>
  import('@app/features/calendar/components/CalendarEmbed').then((module) => ({
    default: module.CalendarEmbed,
  }))
);

function CalendarScrollElement(props: {
  grid: CalendarGridHandle;
  setGrid: Setter<CalendarGridHandle | undefined>;
  setScrollElement: Setter<HTMLElement | undefined>;
}) {
  createEffect(() => {
    props.setGrid(props.grid);
    const host = props.grid.element();
    if (!host) return;

    const updateScrollElement = () => {
      const scroller = Array.from(
        host.querySelectorAll<HTMLElement>('.fc-scroller')
      ).find((element) => element.querySelector('.fc-timegrid-body'));
      props.setScrollElement(scroller);
    };
    const observer = new MutationObserver(updateScrollElement);
    observer.observe(host, { childList: true, subtree: true });
    updateScrollElement();

    onCleanup(() => {
      observer.disconnect();
      props.setGrid(undefined);
      props.setScrollElement(undefined);
    });
  });

  return null;
}

function CalendarOverview(props: {
  open: boolean;
  setGrid: Setter<CalendarGridHandle | undefined>;
  setPeriodTitle: Setter<string>;
}) {
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const [scrollElement, setScrollElement] = createSignal<HTMLElement>();
  const data = useCalendarOccurrenceData({
    range,
    sourceById: calendarView.sourceById,
    isSourceVisible: calendarView.isSourceVisible,
    queryOptions: () => ({ enabled: props.open }),
  });

  return (
    <div class="relative min-h-0 flex-1 bg-menu">
      <Suspense
        fallback={
          <div class="size-full">
            <CalendarGridSkeleton />
          </div>
        }
      >
        <CalendarEmbed
          initialDate={initialDate}
          events={data.visibleEvents()}
          eventsById={data.eventsById()}
          settings={{
            initialView: calendarView.displaySettings.periodView,
            showDayHeaders: true,
            collapseEmptyAllDaySlot: true,
            showWeekends: calendarView.displaySettings.showWeekends,
            weekStartsOn: calendarView.displaySettings.weekStartsOn,
            timeFormat: calendarView.displaySettings.timeFormat,
          }}
          selection={{
            color: 'var(--color-accent)',
            onEventSelect: () => {},
          }}
          onDatesSet={({ start, end, view }) => {
            props.setPeriodTitle(monthYearFormatter.format(view.currentStart));
            const nextRange = createCalendarOccurrenceQueryRange(start, end);
            const previousRange = range();
            if (
              !previousRange ||
              previousRange.start !== nextRange.start ||
              previousRange.end !== nextRange.end ||
              previousRange.startDate !== nextRange.startDate ||
              previousRange.endDate !== nextRange.endDate
            ) {
              setRange(nextRange);
            }
          }}
        >
          {(grid) => (
            <CalendarScrollElement
              grid={grid}
              setGrid={props.setGrid}
              setScrollElement={setScrollElement}
            />
          )}
        </CalendarEmbed>
        <ScrollIndicators
          scrollRef={scrollElement}
          appearance="gradient"
          color="var(--color-menu)"
          noBorderStart
          noBorderEnd
        />
        {data.isLoading() && (
          <div class="absolute inset-0 bg-overlay">
            <CalendarGridSkeleton />
          </div>
        )}
      </Suspense>
    </div>
  );
}

/** Calendar period overview opened from Experimental v6's global top bar. */
export function ExperimentalCalendarPopover() {
  const [open, setOpen] = createSignal(false);
  const [grid, setGrid] = createSignal<CalendarGridHandle>();
  const [periodTitle, setPeriodTitle] = createSignal(
    monthYearFormatter.format(new Date())
  );
  const layout = useSplitLayout();
  const calendarActive = () => {
    const content = globalSplitManager()?.activeSplit()?.content();
    return content?.type === 'calendar';
  };

  const openCalendarView = (openInCurrentSplit: boolean) => {
    setOpen(false);
    layout.openWithSplit(
      { type: 'calendar', id: CALENDAR_BLOCK_ID },
      {
        preferNewSplit: !openInCurrentSplit,
        allowDuplicate: false,
        mergeHistory: false,
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={6}
      flip
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        class={cn(
          'size-8 rounded-lg text-ink-muted [&_svg]:size-4!',
          (open() || calendarActive()) && 'bg-active text-ink'
        )}
        aria-label="Open Calendar overview"
      >
        <WideCalendarIcon />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu max-w-[calc(100vw-1rem)] outline-none">
          <Surface
            depth={4}
            class="flex h-[min(34rem,calc(100vh-4rem))] w-[min(42rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl bg-menu shadow-menu"
          >
            <header class="flex shrink-0 items-center justify-between gap-3 border-b border-edge-muted px-3 py-2">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="w-32 shrink-0 truncate px-1 text-sm font-semibold text-ink">
                  {periodTitle()}
                </h2>
                <div class="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-8 rounded-lg text-ink-muted [&_svg]:size-3.5!"
                    label="Previous period"
                    tooltipPlacement="bottom"
                    aria-label="Previous period"
                    onClick={() => grid()?.api()?.prev()}
                  >
                    <CaretLeftIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-8 rounded-lg text-ink-muted [&_svg]:size-3.5!"
                    label="Next period"
                    tooltipPlacement="bottom"
                    aria-label="Next period"
                    onClick={() => grid()?.api()?.next()}
                  >
                    <CaretRightIcon />
                  </Button>
                </div>
              </div>
              <ExperimentalPopoverSplitAction onOpen={openCalendarView} />
            </header>
            <Suspense
              fallback={
                <div class="min-h-0 flex-1">
                  <CalendarGridSkeleton />
                </div>
              }
            >
              <CalendarViewContextProvider>
                <CalendarOverview
                  open={open()}
                  setGrid={setGrid}
                  setPeriodTitle={setPeriodTitle}
                />
              </CalendarViewContextProvider>
            </Suspense>
          </Surface>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
