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
import type { DayDraftRangeBinding } from '@app/features/calendar/core/day-draft';
import { phoneSlotRange } from '@app/features/calendar/core/phone-slot';
import {
  type CalendarOccurrenceData,
  useCalendarOccurrenceData,
} from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarTimeGridHoverIndicator } from '@app/features/calendar/hooks/use-calendar-time-grid-hover-indicator';
import { useTeamOooEvents } from '@app/features/calendar/hooks/use-team-ooo';
import { createDayDraftRange } from '@app/features/calendar/primitives/create-day-draft-range';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
} from '@app/features/calendar/types';
import {
  clipCalendarDisplayRange,
  isCalendarRangeSupported,
} from '@app/features/calendar/utils/calendar-supported-range';
import { GUEST_EDITS_RESTRICTED } from '@app/features/calendar/utils/event-guest-editing';
import {
  type CalendarEventTimeChange,
  calendarEventTimeFromFullCalendar,
  canEditCalendarEventTime,
} from '@app/features/calendar/utils/event-interaction';
import { consumeSuppressedCalendarDateSelection } from '@app/features/calendar/utils/open-event-outside-press';
import {
  scrollEventChipIntoView,
  timeGridScroller,
} from '@app/features/calendar/utils/time-grid-scroller';
import { mergeCalendarOverlays } from '@app/features/calendar-team/core/merge';
import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import { beginInteraction } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import type { DateSelectArg, DatesSetArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  isGuestEditRefused,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import { Button } from '@ui';
import {
  type Accessor,
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  calendarFocusTargetId,
  useCalendarFocus,
} from '../calendar-focus-target';
import { CalendarMonth } from '../calendar-month';
import { phoneMonthRange } from '../core/phone-month-layout';
import { CalendarLoadingSkeleton } from './CalendarLoadingSkeleton';

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
            gradientColor={isMobile() ? 'panel' : 'surface'}
            class="h-6"
          />
        </Portal>
      )}
    </Show>
  );
}

function CalendarPageDataStatus(props: {
  data: CalendarOccurrenceData;
  changingView: boolean;
  grid: CalendarGridHandle;
  onLoadingBlockingChange: (blocking: boolean) => void;
}) {
  const isRangeUnavailable = createMemo(() => {
    const range = props.data.range();
    return range !== undefined && !isCalendarRangeSupported(range);
  });

  const showLoading = () =>
    !isRangeUnavailable() &&
    !props.data.occurrencesQuery.isError &&
    (props.changingView || props.data.isLoading());

  return (
    <>
      <CalendarLoadingSkeleton
        element={props.grid.element()}
        dateInfo={props.grid.dateInfo()}
        loading={showLoading()}
        disabled={isRangeUnavailable() || props.data.occurrencesQuery.isError}
        onBlockingChange={props.onLoadingBlockingChange}
      />
      <Show when={!isRangeUnavailable() && props.data.occurrencesQuery.isError}>
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <div class="flex max-w-sm flex-col items-center gap-3">
            <div class="text-sm font-semibold text-ink">
              Calendar unavailable
            </div>
            <p class="text-xs text-ink-muted">
              We couldn’t load your calendar events. Try again.
            </p>
            <Button
              aria-label="Retry loading calendar"
              tooltip="Retry loading calendar"
              variant="primary"
              size="sm"
              onClick={() =>
                fireAndForget(
                  props.data.occurrencesQuery.refetch(),
                  'calendar-view'
                )
              }
            >
              Retry
            </Button>
          </div>
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
  const calendarFocus = useCalendarFocus();
  const calendarView = useCalendarView();
  const [loadingDecorationBlocking, setLoadingDecorationBlocking] =
    createSignal(false);
  // Keep the settings object independent of route-period changes. Otherwise
  // reading any grid setting also subscribes FullCalendar to the whole object.
  const initialView = untrack(() => pager.periodView());
  const openEventComposer = useOpenEventComposer();
  const calendarsQuery = useVisibleCalendarsQuery();
  const firstWritableCalendar = createMemo(() =>
    calendarsQuery.isSuccess
      ? calendarsQuery.data?.find((calendar) => calendar.isWritable)
      : undefined
  );
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const [selectionColor, setSelectionColor] = createSignal<string>();
  const [dayDraft, setDayDraft] = createSignal<DayDraftRangeBinding>();
  let requestDayDraftClose: (() => void) | undefined;
  onCleanup(() => dayDraft()?.dispose());
  const effectiveSelectionColor = () =>
    selectionColor() ??
    firstWritableCalendar()?.color ??
    DEFAULT_CALENDAR_SOURCE.color;
  const isActive = () => pager.isActive(props.id);
  const useNarrowWeekdayHeaders = () =>
    !isMobile() && props.useNarrowDayHeaders;
  // Let the checkbox update before remapping occurrences and redrawing the grid.
  // Each page has its own deferred update, so the scheduler can yield between
  // the three FullCalendar instances.
  const renderedHiddenSourceIds = createDeferred(calendarView.hiddenSourceIds);
  const isRenderedSourceVisible = (sourceId: string) =>
    !renderedHiddenSourceIds().has(sourceId);
  const data = useCalendarOccurrenceData({
    range,
    sourceById: calendarView.sourceById,
    sourcesReady: calendarView.sourcesReady,
    isSourceVisible: isRenderedSourceVisible,
    queryOptions: () => ({
      pollWhileSyncing: isActive(),
      refetchOnWindowFocus: isActive(),
    }),
  });
  const teamOoo = useTeamOooEvents({
    range,
    isSourceVisible: isRenderedSourceVisible,
    refetchOnWindowFocus: isActive,
  });
  const visibleEvents = createMemo(() =>
    mergeCalendarOverlays(data.visibleEvents(), teamOoo.events())
  );
  const eventsById = createMemo(
    () => new Map(visibleEvents().map((event) => [event.id, event]))
  );
  const updateEventTime = useUpdateCalendarEventMutation();
  const handleDateClick = (selection: DateClickArg) => {
    if (!isActive() || pager.periodView() !== 'timeGridDay') return;
    if (dayDraft()) {
      requestDayDraftClose?.();
      return;
    }
    if (consumeSuppressedCalendarDateSelection()) return;
    const interaction = beginInteraction('calendar.slot.create');
    const calendar = firstWritableCalendar();
    const range = phoneSlotRange(selection.date, selection.allDay);
    try {
      const draft = selection.allDay ? undefined : createDayDraftRange(range);
      if (draft) setDayDraft(draft);
      else selection.view.calendar.select(range);
      // Keep the full selected hour above the low sheet after its layout settles.
      const scrollFrame = requestAnimationFrame(() => {
        if (isActive())
          selection.view.calendar.scrollToTime({
            hours: Math.max(0, range.start.getHours() - 3),
          });
      });
      setSelectionColor(calendar?.color ?? DEFAULT_CALENDAR_SOURCE.color);
      const handle = openEventComposer({
        initialDrawerHeight: 42,
        dayDraftRange: draft,
        initialValues: {
          ...calendarSelectionToEditorInitialValues(range, true),
          ...(calendar ? { calendarId: calendar.id } : {}),
        },
        onCalendarChange: (_calendarId, color) => setSelectionColor(color),
        onClose: () => {
          cancelAnimationFrame(scrollFrame);
          selection.view.calendar.unselect();
          draft?.dispose();
          if (dayDraft() === draft) {
            setDayDraft(undefined);
            requestDayDraftClose = undefined;
          }
          setSelectionColor(undefined);
        },
      });
      requestDayDraftClose = handle?.close;
    } finally {
      interaction.end();
    }
  };
  const handleSelect = (selection: DateSelectArg) => {
    if (!isActive()) return;
    // The press that closes open event details also hits the grid. FullCalendar
    // selects on mouseup, after the details have already closed, so that
    // gesture must not open a new event.
    if (consumeSuppressedCalendarDateSelection()) {
      selection.view.calendar.unselect();
      return;
    }
    const calendar = firstWritableCalendar();
    const gridElement = pager.activePage()?.element();
    setSelectionColor(calendar?.color ?? DEFAULT_CALENDAR_SOURCE.color);
    openEventComposer({
      anchorRect: () => {
        if (!isActive() || !gridElement?.isConnected) return undefined;
        return gridElement
          .querySelector<HTMLElement>('.fc-highlight')
          ?.getBoundingClientRect();
      },
      returnFocus: gridElement,
      initialValues: {
        ...calendarSelectionToEditorInitialValues(selection, true),
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

  const handleDatesSet = ({ end, start, view }: DatesSetArg) => {
    // The phone Bars face is Sunday-first regardless of the desktop week preference.
    const phoneMonth = isMobile() && view.type === 'dayGridMonth';
    const monthRange = phoneMonth
      ? phoneMonthRange(view.currentStart)
      : undefined;
    const requestedStart = monthRange?.start ?? start;
    const requestedEnd = monthRange?.end ?? end;
    const clipped = phoneMonth
      ? clipCalendarDisplayRange(requestedStart, requestedEnd)
      : undefined;
    const nextRange = createCalendarOccurrenceQueryRange(
      clipped?.start ?? requestedStart,
      clipped?.end ?? requestedEnd
    );
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
      { eventId: event.eventId, calendarId: event.calendarId, patch: { time } },
      {
        onError: (error) => {
          change.revert();
          if (isGuestEditRefused(error)) {
            toast.failure(GUEST_EDITS_RESTRICTED);
            return;
          }
          toast.failure('Failed to update event', {
            subtext: error.message,
          });
        },
      }
    );
  };

  return (
    <div
      class="relative size-full min-w-0 min-h-0"
      classList={{
        'phone-month-page': isMobile() && pager.periodView() === 'dayGridMonth',
      }}
      aria-busy={
        data.isLoading() ||
        (isActive() && pager.isChangingView()) ||
        loadingDecorationBlocking()
      }
    >
      <CalendarGrid
        initialDate={props.initialDate}
        dayDraft={dayDraft()}
        events={visibleEvents()}
        eventsById={eventsById()}
        settings={{
          initialView,
          showWeekends: calendarView.displaySettings.showWeekends,
          compactAllDaySlot: isMobile(),
          weekStartsOn: calendarView.displaySettings.weekStartsOn,
          timeFormat: calendarView.displaySettings.timeFormat,
          useNarrowDayHeaders: useNarrowWeekdayHeaders(),
          useNarrowEventContent: props.useNarrowDayHeaders,
        }}
        selection={{
          color: effectiveSelectionColor(),
          eventId: isActive() ? calendarView.selectedEvent()?.id : undefined,
          onDateSelect: isMobile() ? undefined : handleSelect,
          onDateClick: isMobile() ? handleDateClick : undefined,
          onEventSelect: (event, element) => {
            if (!isActive()) return;
            if (dayDraft()) {
              requestDayDraftClose?.();
              return;
            }
            calendarView.selectEvent(event, element);
          },
          onSelectedEventMount: (event, element) => {
            if (isActive()) calendarView.reanchorSelectedEvent(event, element);
          },
        }}
        eventTimeChangePending={updateEventTime.isPending}
        onDatesSet={handleDatesSet}
        onEventTimeChange={handleEventTimeChange}
      >
        {(grid) => (
          <>
            <CalendarPageHost
              id={props.id}
              data={data}
              teamEvents={teamOoo.events}
              eventsById={eventsById}
              grid={grid}
              onLoadingBlockingChange={setLoadingDecorationBlocking}
              scrollIndicators={!isMobile()}
              focusInOverlay={
                isMobile() && pager.periodView() === 'dayGridMonth'
              }
            />
            <Show when={pager.periodView() === 'dayGridMonth'}>
              <CalendarMonth
                range={grid.dateInfo()}
                initialDate={props.initialDate}
                events={visibleEvents()}
                timeFormat={calendarView.displaySettings.timeFormat}
                showWeekends={calendarView.displaySettings.showWeekends}
                focusTarget={
                  isActive() ? calendarFocus.pendingTarget() : undefined
                }
                onFocusHandled={(requestId) => calendarFocus.consume(requestId)}
                onSelect={(event, element) => {
                  if (isActive()) calendarView.selectEvent(event, element);
                }}
              />
            </Show>
          </>
        )}
      </CalendarGrid>
    </div>
  );
}

function CalendarPageHost(props: {
  id: CalendarPageId;
  data: CalendarOccurrenceData;
  /** Teammate out-of-office events rendered on this page. */
  teamEvents: Accessor<CalendarEvent[]>;
  /** Occurrence events merged with the team out-of-office overlay. */
  eventsById: Accessor<Map<string, CalendarEvent>>;
  grid: CalendarGridHandle;
  onLoadingBlockingChange: (blocking: boolean) => void;
  focusInOverlay?: boolean;
  scrollIndicators: boolean;
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
    // Cached occurrences can resolve before onMount registers this page.
    // Wait reactively so a no-op navigation cannot consume the request.
    if (!pager.activePage()?.api()) return;
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
    if (props.focusInOverlay) return;
    const targetId = calendarFocusTargetId(target);
    const event = props.eventsById().get(targetId);
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
      teamEvents: props.teamEvents,
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
        !props.data.occurrencesQuery.isFetching
      ) {
        fireAndForget(props.data.occurrencesQuery.refetch(), 'calendar-view');
      }
    })
  );

  createEffect(
    on(
      () =>
        [
          isActive(),
          calendarView.selectedEvent()?.id,
          props.eventsById(),
        ] as const,
      ([active, selectedEventId, eventsById]) => {
        if (!active || !selectedEventId) return;

        // An absent event proves nothing until its occurrences and source
        // metadata are ready to render.
        calendarView.refreshSelectedEventFromPage(
          eventsById,
          props.data.occurrencesQuery.isSuccess && !props.data.isLoading()
        );
      }
    )
  );

  return (
    <>
      <Show when={props.scrollIndicators}>
        <CalendarScrollIndicators calendarElement={props.grid.element} />
      </Show>
      <CalendarPageDataStatus
        data={props.data}
        changingView={isActive() && pager.isChangingView()}
        grid={props.grid}
        onLoadingBlockingChange={props.onLoadingBlockingChange}
      />
    </>
  );
}
