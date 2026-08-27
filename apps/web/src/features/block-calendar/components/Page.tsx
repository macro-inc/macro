import {
  CalendarGrid,
  type CalendarGridHandle,
} from '@app/features/calendar/components/CalendarGrid';
import {
  type CalendarPageId,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { calendarSelectionToEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import {
  type CalendarOccurrenceData,
  useCalendarOccurrenceData,
} from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarTimeGridHoverIndicator } from '@app/features/calendar/hooks/use-calendar-time-grid-hover-indicator';
import type { CalendarEvent } from '@app/features/calendar/types';
import { DEFAULT_CALENDAR_SOURCE } from '@app/features/calendar/types';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import {
  type CalendarEventTimeChange,
  calendarEventTimeFromFullCalendar,
  canEditCalendarEventTime,
} from '@app/features/calendar/utils/event-interaction';
import {
  scrollEventChipIntoView,
  timeGridScroller,
} from '@app/features/calendar/utils/time-grid-scroller';
import { toast } from '@core/component/Toast/Toast';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { isMobile } from '@core/mobile/isMobile';
import type { DateSelectArg, DatesSetArg } from '@fullcalendar/core';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useUpdateCalendarEventMutation } from '@queries/calendar/mutations';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  calendarFocusTargetId,
  useCalendarFocus,
} from '../calendar-focus-target';
import { useOpenEventComposer } from './use-open-event-composer';

interface CalendarScrollTarget {
  scrollElement: HTMLElement;
  fadeContainer: HTMLElement;
}

function CalendarScrollIndicators(props: {
  calendarElement: Accessor<HTMLElement | undefined>;
}) {
  const [target, setTarget] = createSignal<CalendarScrollTarget>();

  createEffect(
    on(props.calendarElement, (element) => {
      if (!element) {
        setTarget(undefined);
        return;
      }

      let updateFrame: number | undefined;
      const updateScrollElements = () => {
        const scrollElement = timeGridScroller(element);
        const fadeContainer = scrollElement?.parentElement;
        setTarget((current) => {
          if (!scrollElement || !fadeContainer) return undefined;
          return current?.scrollElement === scrollElement &&
            current.fadeContainer === fadeContainer
            ? current
            : { scrollElement, fadeContainer };
        });
      };
      const scheduleScrollElementUpdate = () => {
        if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
        updateFrame = requestAnimationFrame(() => {
          updateFrame = undefined;
          updateScrollElements();
        });
      };

      const mutationObserver = new MutationObserver(
        scheduleScrollElementUpdate
      );
      mutationObserver.observe(element, { childList: true, subtree: true });
      scheduleScrollElementUpdate();

      onCleanup(() => {
        mutationObserver.disconnect();
        if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      });
    })
  );

  return (
    <Show keyed when={target()}>
      {(scrollTarget) => (
        <Portal
          mount={scrollTarget.fadeContainer}
          ref={(container) => {
            container.style.display = 'contents';
          }}
        >
          <ScrollIndicators
            scrollRef={() => scrollTarget.scrollElement}
            appearance="gradient"
            class="h-6"
          />
        </Portal>
      )}
    </Show>
  );
}

function CalendarPageDataStatus(props: { data: CalendarOccurrenceData }) {
  const isRangeUnavailable = createMemo(() => {
    const range = props.data.range();
    return range !== undefined && !isCalendarRangeSupported(range);
  });

  const showLoading = () =>
    !isRangeUnavailable() &&
    !props.data.occurrencesQuery.isError &&
    props.data.isLoading();

  const showBlockingState = () => {
    if (isRangeUnavailable()) return false;
    if (props.data.occurrencesQuery.isError) return true;
    if (showLoading()) return false;

    return props.data.isSyncing() && props.data.events().length === 0;
  };

  return (
    <>
      <Show when={showBlockingState()}>
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <Show
            when={!props.data.occurrencesQuery.isError}
            fallback={
              <div class="flex max-w-sm flex-col items-center gap-3">
                <div class="text-sm font-semibold text-ink">
                  Calendar unavailable
                </div>
                <p class="text-xs text-ink-muted">
                  We couldn’t load your calendar events. Try again.
                </p>
                <Button
                  variant="accent"
                  size="sm"
                  label="Retry loading calendar"
                  onClick={() => void props.data.occurrencesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            }
          >
            <div class="flex items-center gap-2 text-xs text-ink-muted">
              <SpinnerIcon class="size-4 animate-spin" />
              <span>Syncing calendar…</span>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={showLoading()}>
        <div class="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-menu">
          <SpinnerIcon class="size-3 animate-spin" />
          Loading
        </div>
      </Show>

      <Show
        when={
          !isRangeUnavailable() &&
          !showLoading() &&
          !showBlockingState() &&
          props.data.isSyncing() &&
          props.data.events().length > 0
        }
      >
        <div class="absolute right-2 bottom-2 z-10 flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-menu">
          <SpinnerIcon class="size-3 animate-spin" />
          Syncing
        </div>
      </Show>
    </>
  );
}

/** One independently rendered and queried FullCalendar page. */
export function Page(props: {
  id: CalendarPageId;
  initialDate: Date;
  useNarrowDayHeaders: boolean;
}) {
  const pager = useCalendarPager();
  const calendarView = useCalendarView();
  const openEventComposer = useOpenEventComposer();
  const calendarsQuery = useVisibleCalendarsQuery();
  const firstWritableCalendar = createMemo(() =>
    calendarsQuery.data?.find((calendar) => calendar.isWritable)
  );
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const [selectionColor, setSelectionColor] = createSignal<string>();
  const effectiveSelectionColor = () =>
    selectionColor() ??
    firstWritableCalendar()?.color ??
    DEFAULT_CALENDAR_SOURCE.color;
  const isActive = () => pager.isActive(props.id);
  const useNarrowWeekdayHeaders = () =>
    props.useNarrowDayHeaders && !isMobile();
  const data = useCalendarOccurrenceData({
    range,
    sourceById: calendarView.sourceById,
    isSourceVisible: calendarView.isSourceVisible,
    queryOptions: () => ({
      pollWhileSyncing: isActive(),
      refetchOnWindowFocus: isActive(),
    }),
  });
  const updateEventTime = useUpdateCalendarEventMutation();
  const handleSelect = (selection: DateSelectArg) => {
    if (!isActive()) return;
    const calendar = firstWritableCalendar();
    setSelectionColor(calendar?.color ?? DEFAULT_CALENDAR_SOURCE.color);
    openEventComposer({
      initialValues: {
        ...calendarSelectionToEditorInitialValues(selection),
        ...(calendar ? { calendarId: calendar.id } : {}),
      },
      onCalendarChange: (_calendarId: string, color: string) =>
        setSelectionColor(color),
      onClose: () => {
        selection.view.calendar.unselect();
        setSelectionColor(undefined);
      },
    });
  };

  const handleDatesSet = ({ end, start }: DatesSetArg) => {
    const nextRange = createCalendarOccurrenceQueryRange(start, end);
    const currentRange = range();
    if (
      currentRange?.start === nextRange.start &&
      currentRange.end === nextRange.end &&
      currentRange.startDate === nextRange.startDate &&
      currentRange.endDate === nextRange.endDate
    ) {
      return;
    }
    setRange(nextRange);
  };

  const handleEventTimeChange = (
    change: CalendarEventTimeChange,
    event: CalendarEvent | undefined
  ) => {
    if (
      !isActive() ||
      updateEventTime.isPending ||
      !event ||
      !canEditCalendarEventTime(event)
    ) {
      change.revert();
      return;
    }

    const time = calendarEventTimeFromFullCalendar(change.event, event);
    if (!time) {
      change.revert();
      return;
    }

    updateEventTime.mutate(
      { eventId: event.eventId, patch: { time } },
      {
        onError: (error) => {
          change.revert();
          toast.failure('Failed to update event', {
            subtext: error.message,
          });
        },
      }
    );
  };

  return (
    <CalendarGrid
      initialDate={props.initialDate}
      events={data.visibleEvents()}
      eventsById={data.eventsById()}
      settings={{
        initialView: calendarView.displaySettings.periodView,
        showWeekends: calendarView.displaySettings.showWeekends,
        weekStartsOn: calendarView.displaySettings.weekStartsOn,
        timeFormat: calendarView.displaySettings.timeFormat,
        useNarrowDayHeaders: useNarrowWeekdayHeaders(),
        useNarrowEventContent: props.useNarrowDayHeaders,
      }}
      selection={{
        color: effectiveSelectionColor(),
        eventId: isActive() ? calendarView.selectedEvent()?.id : undefined,
        onDateSelect: isMobile() ? undefined : handleSelect,
        onEventSelect: (event, element) => {
          if (isActive()) calendarView.selectEvent(event, element);
        },
      }}
      eventTimeChangePending={updateEventTime.isPending}
      onDatesSet={handleDatesSet}
      onEventTimeChange={handleEventTimeChange}
    >
      {(grid) => <CalendarPageHost id={props.id} data={data} grid={grid} />}
    </CalendarGrid>
  );
}

function CalendarPageHost(props: {
  id: CalendarPageId;
  data: CalendarOccurrenceData;
  grid: CalendarGridHandle;
}) {
  const pager = useCalendarPager();
  const calendarView = useCalendarView();
  const calendarFocus = useCalendarFocus();
  const isActive = () => pager.isActive(props.id);

  // A block navigation request pages this calendar instance to one occurrence
  // and opens its details once FullCalendar has mounted the target chip.
  let navigatedFor: number | undefined;
  createEffect(() => {
    props.grid.chipMounts();
    const target = calendarFocus.pendingTarget();
    if (!target || !isActive()) return;
    const dateInfo = props.grid.dateInfo();
    if (!dateInfo) return;
    if (target.date < dateInfo.start || target.date >= dateInfo.end) {
      // Navigate once per request; the effect re-runs as the destination
      // page's chips mount, and by then the date is inside the view.
      if (navigatedFor !== target.requestId) {
        navigatedFor = target.requestId;
        pager.navigateToDate(target.date);
      }
      return;
    }
    const targetId = calendarFocusTargetId(target);
    const event = props.data.eventsById().get(targetId);
    const chip = props.grid.eventElements.get(targetId);
    if (!event || !chip?.isConnected) return;
    calendarFocus.consume(target.requestId);
    scrollEventChipIntoView(props.grid.element(), chip);
    calendarView.selectEvent(event, chip);
  });

  useCalendarTimeGridHoverIndicator(() =>
    isActive() ? props.grid.element() : undefined
  );

  onMount(() => {
    const unregister = pager.registerPage({
      id: props.id,
      api: props.grid.api,
      dateInfo: props.grid.dateInfo,
      element: props.grid.element,
      data: props.data,
    });
    onCleanup(unregister);
  });

  createEffect(
    on(isActive, (active, wasActive) => {
      if (
        active &&
        wasActive === false &&
        props.data.occurrencesQuery.isSuccess &&
        props.data.occurrencesQuery.isStale &&
        !props.data.occurrencesQuery.isFetching &&
        !props.data.occurrencesQuery.isPlaceholderData
      ) {
        void props.data.occurrencesQuery.refetch();
      }
    })
  );

  createEffect(
    on(
      () =>
        [
          isActive(),
          calendarView.selectedEvent()?.id,
          props.data.occurrencesQuery.dataUpdatedAt,
        ] as const,
      ([active, selectedEventId]) => {
        if (
          !active ||
          !selectedEventId ||
          !props.data.occurrencesQuery.isSuccess ||
          props.data.occurrencesQuery.isPlaceholderData
        ) {
          return;
        }

        const selectedEvent = props.data.eventsById().get(selectedEventId);
        if (selectedEvent) calendarView.refreshSelectedEvent(selectedEvent);
        else calendarView.closeEventDetails();
      }
    )
  );

  return (
    <>
      <CalendarScrollIndicators calendarElement={props.grid.element} />
      <CalendarPageDataStatus data={props.data} />
    </>
  );
}
