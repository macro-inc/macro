import type { CalendarGridHandle } from '@app/features/calendar/components/CalendarGrid';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import type { CalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarSources } from '@app/features/calendar/hooks/use-calendar-sources';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { formatLocalDate } from '@app/features/calendar/utils/calendar-date';
import { getDefaultCalendarTimeFormat } from '@app/features/calendar/utils/time-format';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import './EventPreview.css';
import {
  buildCalendarToolPreviewEvent,
  type CalendarToolPreviewWindow,
  calendarToolPreviewStartDate,
  calendarToolPreviewWindow,
  expandCalendarToolPreviewEvents,
} from './event-preview-model';

const CalendarEmbed = lazy(() =>
  import('@app/features/calendar/components/CalendarEmbed').then((module) => ({
    default: module.CalendarEmbed,
  }))
);

const MAX_EXISTING_PREVIEW_EVENTS = 50;
const PREVIEW_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});

function previewScrollTime(date: Date) {
  const startMinutes = date.getHours() * 60 + date.getMinutes();
  const scrollMinutes = Math.max(0, startMinutes - 60);
  const hours = Math.floor(scrollMinutes / 60);
  const minutes = scrollMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function dayPreviewWindow(date: Date): CalendarToolPreviewWindow {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { view: 'timeGridDay', start, end };
}

function previewWindowsEqual(
  first: CalendarToolPreviewWindow | undefined,
  second: CalendarToolPreviewWindow | undefined
) {
  return (
    first?.view === second?.view &&
    first?.start.getTime() === second?.start.getTime() &&
    first?.end.getTime() === second?.end.getTime() &&
    first?.dayCount === second?.dayCount
  );
}

function CalendarPreviewViewport(props: {
  grid: CalendarGridHandle;
  start: string;
  allDay: boolean;
  view: CalendarPeriodView;
  initialView: CalendarPeriodView;
  dayCount?: number;
  eventIds: ReadonlySet<string>;
}) {
  let visibleDay: string | undefined;
  let visibleView = props.initialView;
  let visibleDayCount = props.dayCount;
  let scrollFrame: number | undefined;

  createEffect(() => {
    const allDay = props.allDay;
    const date = calendarToolPreviewStartDate(props.start, allDay);
    const api = props.grid.api();
    if (!date || !api) return;

    const day = formatLocalDate(date);
    const view = props.view;
    const dayCount = props.dayCount;
    if (view !== visibleView || dayCount !== visibleDayCount) {
      visibleView = view;
      visibleDayCount = dayCount;
      visibleDay = day;
      api.changeView(view, date);
    } else if (day !== visibleDay) {
      visibleDay = day;
      api.gotoDate(date);
    }
  });

  createEffect(() => {
    const allDay = props.allDay;
    const date = calendarToolPreviewStartDate(props.start, allDay);
    const view = props.view;
    const eventIds = untrack(() => props.eventIds);
    const dateInfo = props.grid.dateInfo();
    const api = props.grid.api();
    // Re-run after FullCalendar mounts event chips for a new view.
    props.grid.chipMounts();

    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    if (
      !date ||
      !dateInfo ||
      !api ||
      dateInfo.view.type !== view ||
      date < dateInfo.start ||
      date >= dateInfo.end
    ) {
      return;
    }

    if (view === 'dayGridMonth') {
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined;
        for (const eventId of eventIds) {
          const element = props.grid.eventElements.get(eventId);
          if (!element) continue;
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          break;
        }
      });
      return;
    }
    if (allDay) return;

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      api.scrollToTime(previewScrollTime(date));
    });
  });

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });

  return null;
}

interface CalendarToolEventPreviewProps {
  controller: CalendarEventFormController;
  eventId: string;
  timeZone?: string;
  /** Whether to display the preview date's month and year above the grid. */
  showPeriodLabel?: boolean;
  /** Whether to show previous/next controls in week and month views. */
  showNavigationControls?: boolean;
  /** Optional controls aligned to the right in place of built-in navigation. */
  navigationControls?: JSX.Element;
  class?: string;
}

/** Live day-grid preview for a deferred calendar event tool call. */
export function CalendarToolEventPreview(props: CalendarToolEventPreviewProps) {
  const previewEvent = createMemo(() =>
    buildCalendarToolPreviewEvent({
      id: props.eventId,
      values: props.controller.state(),
      time: props.controller.eventTime(),
      recurrenceLines: props.controller.recurrenceLines(),
      calendar: props.controller.selectedCalendarOption(),
      timeZone: props.timeZone,
    })
  );
  const editorStart = createMemo(() => props.controller.state().start);
  const editorAllDay = createMemo(() => props.controller.state().allDay);
  const previewDay = createMemo(() => {
    const date = calendarToolPreviewStartDate(editorStart(), editorAllDay());
    return date ? formatLocalDate(date) : undefined;
  });
  const previewDate = createMemo(() => {
    const day = previewDay();
    return day ? calendarToolPreviewStartDate(day, true) : undefined;
  });
  const previewColor = createMemo(() => previewEvent()?.calendar.color);
  const previewWindow = createMemo<CalendarToolPreviewWindow | undefined>(
    () => {
      const event = previewEvent();
      if (event) return calendarToolPreviewWindow(event);
      const date = previewDate();
      return date ? dayPreviewWindow(date) : undefined;
    },
    undefined,
    { equals: previewWindowsEqual }
  );
  const previewView = () => previewWindow()?.view ?? 'timeGridDay';
  const previewDayCount = () => previewWindow()?.dayCount;
  const previewLayoutKey = () => previewDayCount() ?? 'standard';
  const [displayedWindow, setDisplayedWindow] =
    createSignal<CalendarToolPreviewWindow>();
  const [displayedDate, setDisplayedDate] = createSignal<Date>();
  let activeGrid: CalendarGridHandle | undefined;
  const visibleWindow = createMemo(() => {
    const displayed = displayedWindow();
    return displayed?.view === previewView() &&
      displayed.dayCount === previewDayCount()
      ? displayed
      : previewWindow();
  });
  const range = createMemo(() => {
    const window = visibleWindow();
    return window
      ? createCalendarOccurrenceQueryRange(window.start, window.end)
      : undefined;
  });
  const { sourceById } = useCalendarSources();
  const occurrenceData = useCalendarOccurrenceData({ range, sourceById });
  const availableExistingEvents = createMemo(() =>
    occurrenceData.occurrencesQuery.isPlaceholderData
      ? []
      : occurrenceData.visibleEvents()
  );
  const existingEvents = createMemo(() =>
    availableExistingEvents().slice(0, MAX_EXISTING_PREVIEW_EVENTS)
  );
  const previewEvents = createMemo(() => {
    const event = previewEvent();
    const window = visibleWindow();
    return event && window
      ? expandCalendarToolPreviewEvents(event, window)
      : [];
  });
  const events = createMemo(() => [...existingEvents(), ...previewEvents()]);
  const emphasizedEventIds = createMemo(
    () => new Set(previewEvents().map((event) => event.id))
  );
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );
  const showBuiltInNavigation = () =>
    props.showNavigationControls === true && previewView() !== 'timeGridDay';
  const showPreviewHeader = () =>
    props.showPeriodLabel === true ||
    showBuiltInNavigation() ||
    props.navigationControls !== undefined;
  const periodDate = () => {
    const displayed = displayedWindow();
    return displayed?.view === previewView() &&
      displayed.dayCount === previewDayCount()
      ? (displayedDate() ?? previewDate())
      : previewDate();
  };
  const isEventStartVisible = () => {
    const date = calendarToolPreviewStartDate(editorStart(), editorAllDay());
    const displayed = displayedWindow();
    return (
      !date || !displayed || (date >= displayed.start && date < displayed.end)
    );
  };
  const navigate = (direction: 'previous' | 'next') => {
    const api = activeGrid?.api();
    if (!api) return;
    if (direction === 'previous') api.prev();
    else api.next();
  };
  const goToEvent = () => {
    const date = calendarToolPreviewStartDate(editorStart(), editorAllDay());
    if (date) activeGrid?.api()?.gotoDate(date);
  };

  return (
    <div
      role="region"
      aria-label="Calendar event preview"
      class={cn(
        'calendar-tool-preview relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-sm',
        props.class
      )}
    >
      <Show when={showPreviewHeader()}>
        <div class="flex shrink-0 items-center border-b border-edge-muted px-3 py-2">
          <Show when={props.showPeriodLabel ? periodDate() : undefined}>
            {(date) => (
              <div class="text-sm font-semibold text-ink">
                {PREVIEW_MONTH_YEAR_FORMAT.format(date())}
              </div>
            )}
          </Show>
          <Show
            when={
              props.navigationControls !== undefined || showBuiltInNavigation()
            }
          >
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <Show
                when={props.navigationControls !== undefined}
                fallback={
                  <>
                    <Show when={!isEventStartVisible()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="rounded-lg px-2"
                        onClick={goToEvent}
                      >
                        <CalendarIcon class="size-3.5" />
                        Go to event
                      </Button>
                    </Show>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-lg"
                      label={`Previous ${previewView() === 'dayGridMonth' ? 'month' : 'week'}`}
                      onClick={() => navigate('previous')}
                    >
                      <CaretLeftIcon class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-lg"
                      label={`Next ${previewView() === 'dayGridMonth' ? 'month' : 'week'}`}
                      onClick={() => navigate('next')}
                    >
                      <CaretRightIcon class="size-4" />
                    </Button>
                  </>
                }
              >
                {props.navigationControls}
              </Show>
            </div>
          </Show>
        </div>
      </Show>
      <div class="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <CalendarGridSkeleton
              showDayHeader={false}
              showAllDaySlot={false}
            />
          }
        >
          <Show when={previewLayoutKey()} keyed>
            {(layoutKey) => {
              // FullCalendar cannot safely remove dayCount in place. Remount only
              // when entering, leaving, or resizing an exact multi-day layout.
              const dayCount =
                typeof layoutKey === 'number' ? layoutKey : undefined;
              const initialView = previewView();
              return (
                <CalendarEmbed
                  initialDate={previewDate() ?? new Date()}
                  events={events()}
                  eventsById={eventsById()}
                  emphasizedEventIds={emphasizedEventIds()}
                  settings={{
                    initialView,
                    dayCount,
                    showDayHeaders: previewView() !== 'timeGridDay',
                    useNarrowDayHeaders: false,
                    collapseEmptyAllDaySlot: true,
                    showWeekends: true,
                    weekStartsOn: 0,
                    timeFormat: getDefaultCalendarTimeFormat(),
                  }}
                  selection={{
                    color: previewColor() ?? 'var(--color-accent)',
                  }}
                  onDatesSet={(info) => {
                    setDisplayedWindow({
                      view: info.view.type as CalendarPeriodView,
                      start: info.start,
                      end: info.end,
                      dayCount,
                    });
                    setDisplayedDate(info.view.calendar.getDate());
                  }}
                >
                  {(grid) => {
                    activeGrid = grid;
                    return (
                      <CalendarPreviewViewport
                        grid={grid}
                        start={editorStart()}
                        allDay={editorAllDay()}
                        view={previewView()}
                        initialView={initialView}
                        dayCount={dayCount}
                        eventIds={emphasizedEventIds()}
                      />
                    );
                  }}
                </CalendarEmbed>
              );
            }}
          </Show>
          <Show when={previewEvent() === undefined}>
            <div class="pointer-events-none absolute inset-x-2 top-2 rounded-md border border-edge-muted bg-surface px-2 py-1 text-center text-xs text-ink-muted shadow-sm">
              Enter an end time after the start time to preview this event.
            </div>
          </Show>
          <Show when={occurrenceData.isLoading()}>
            <div
              role="status"
              aria-label="Loading calendar events"
              class="pointer-events-none absolute right-2 bottom-2 rounded-md border border-edge-muted bg-surface px-2 py-1 text-xs text-ink-muted shadow-sm"
            >
              Loading events…
            </div>
          </Show>
          <Show when={occurrenceData.occurrencesQuery.isError}>
            <div class="absolute inset-x-2 bottom-2 rounded-md border border-edge-muted bg-surface px-2 py-1 text-center text-xs text-ink-muted shadow-sm">
              Other calendar events couldn’t be loaded.
            </div>
          </Show>
        </Suspense>
      </div>
    </div>
  );
}
