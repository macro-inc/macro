import { useOpenEventComposer } from '@app/features/block-calendar/components/use-open-event-composer';
import {
  CALENDAR_BLOCK_ID,
  type CalendarBlockProps,
} from '@app/features/block-calendar/types';
import type { CalendarGridHandle } from '@app/features/calendar/components/CalendarGrid';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarSources } from '@app/features/calendar/hooks/use-calendar-sources';
import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import {
  formatCalendarTime,
  getDefaultCalendarTimeFormat,
} from '@app/features/calendar/utils/time-format';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HoverCard } from '@core/component/HoverCard';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { openExternalUrl } from '@core/util/url';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { Layer } from '@ui/components/Layer';
import { Surface } from '@ui/components/Surface';
import {
  createEffect,
  createSignal,
  For,
  lazy,
  onCleanup,
  type ParentProps,
  type Setter,
  Show,
  Suspense,
} from 'solid-js';

const CalendarEmbed = lazy(() =>
  import('@app/features/calendar/components/CalendarEmbed').then((module) => ({
    default: module.CalendarEmbed,
  }))
);

function dayRange(date: Date): CalendarOccurrenceQueryRange {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return createCalendarOccurrenceQueryRange(start, end);
}

function PreviewSkeleton() {
  return <CalendarGridSkeleton showDayHeader={false} showAllDaySlot={false} />;
}

function CalendarScrollElement(props: {
  grid: CalendarGridHandle;
  setScrollElement: Setter<HTMLElement | undefined>;
}) {
  createEffect(() => {
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
      props.setScrollElement(undefined);
    });
  });

  return null;
}

const PREVIEW_TIME_FORMAT_OPTIONS: Array<{
  value: CalendarTimeFormat;
  label: string;
}> = [
  { value: '12-hour', label: '12-hour' },
  { value: '24-hour', label: '24-hour' },
];

const eventDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function eventDate(value: string) {
  return parseLocalDate(value) ?? new Date(value);
}

function eventSchedule(event: CalendarEvent) {
  const start = eventDate(event.start);
  if (event.allDay) return `${eventDateFormat.format(start)} · All day`;

  const end = eventDate(event.end);
  const timeFormat = getDefaultCalendarTimeFormat();
  return `${eventDateFormat.format(start)} · ${formatCalendarTime(start, timeFormat)}–${formatCalendarTime(end, timeFormat)}`;
}

function conferenceUrl(event: CalendarEvent) {
  if (!event.conferenceUrl) return undefined;

  try {
    const url = new URL(event.conferenceUrl);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function EventSummary(props: {
  event: CalendarEvent;
  onClose: () => void;
  onViewInCalendar: () => void;
}) {
  return (
    <div class="shrink-0 border-t border-edge bg-surface">
      <div class="flex h-10 items-center justify-between px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg"
          label="Close event details"
          onClick={props.onClose}
        >
          <XIcon class="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          depth={4}
          class="rounded-lg bg-surface px-2"
          data-calendar-event-target-navigation
          onClick={props.onViewInCalendar}
        >
          Open
          <ArrowRightIcon class="size-4" />
        </Button>
      </div>
      <div class="flex flex-col gap-2 px-3 pb-3 pt-2">
        <div class="flex min-w-0 items-start gap-2">
          <span
            aria-hidden="true"
            class="mt-0.5 size-3 shrink-0 rounded-sm"
            style={{ 'background-color': props.event.calendar.color }}
          />
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold text-ink">
              {props.event.title}
            </h3>
            <p class="text-xs text-ink-muted">{eventSchedule(props.event)}</p>
          </div>
        </div>
        <Show when={conferenceUrl(props.event)}>
          {(url) => (
            <Button
              fullWidth
              variant="cta"
              size="sm"
              class="h-8 rounded-lg"
              onClick={() => openExternalUrl(url())}
            >
              <VideoCameraIcon class="size-4" />
              {props.event.conferenceProvider === 'google_meet'
                ? 'Join Google Meet'
                : 'Join meeting'}
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

function PreviewContent(props: { dropdownMount?: HTMLElement }) {
  const initialDate = new Date();
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>(
    dayRange(initialDate)
  );
  const [selectedEventId, setSelectedEventId] = createSignal<string>();
  const [scrollElement, setScrollElement] = createSignal<HTMLElement>();
  const [hiddenSourceIds, setHiddenSourceIds] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [timeFormat, setTimeFormat] = createSignal<CalendarTimeFormat>(
    getDefaultCalendarTimeFormat()
  );
  const layout = useSplitLayout();
  const openEventComposer = useOpenEventComposer();
  const { sourceById, sources } = useCalendarSources();
  const isSourceVisible = (sourceId: string) =>
    !hiddenSourceIds().has(sourceId);
  const data = useCalendarOccurrenceData({
    range,
    sourceById,
    isSourceVisible,
  });
  const selectedEvent = () => {
    const eventId = selectedEventId();
    return eventId ? data.eventsById().get(eventId) : undefined;
  };
  const setSourceVisibility = (sourceId: string, visible: boolean) => {
    setHiddenSourceIds((current) => {
      const next = new Set(current);
      if (visible) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
    if (!visible && selectedEvent()?.calendar.id === sourceId) {
      setSelectedEventId(undefined);
    }
  };
  const openEventInCalendar = async (event: CalendarEvent) => {
    const params: CalendarBlockProps = {
      eventId: event.eventId,
      occurrenceKey: event.occurrenceKey,
      range: range(),
    };
    const manager = globalSplitManager();
    const existing = manager?.getSplitByContent('calendar', CALENDAR_BLOCK_ID);
    if (existing) {
      existing.activate();
    } else {
      layout.openWithSplit(
        { type: 'calendar', id: CALENDAR_BLOCK_ID, params },
        {
          allowDuplicate: false,
          mergeHistory: false,
          referredFrom: 'sidebar',
        }
      );
    }

    const calendarHandle = await manager
      ?.getOrchestrator()
      .getBlockHandle(CALENDAR_BLOCK_ID, 'calendar');
    await calendarHandle?.goToLocationFromParams(params);
  };

  return (
    <div class="calendar-sidebar-preview portal-scope flex size-full min-h-0 flex-col bg-surface">
      <div class="relative min-h-0 flex-1">
        <CalendarEmbed
          initialDate={initialDate}
          events={data.visibleEvents()}
          eventsById={data.eventsById()}
          settings={{
            initialView: 'timeGridDay',
            dayCount: 1,
            showDayHeaders: false,
            collapseEmptyAllDaySlot: true,
            showWeekends: true,
            weekStartsOn: 0,
            timeFormat: timeFormat(),
          }}
          selection={{
            color: 'var(--color-accent)',
            eventId: selectedEventId(),
            onEventSelect: (event) => setSelectedEventId(event.id),
          }}
          onDatesSet={({ start, end }) => {
            const nextRange = createCalendarOccurrenceQueryRange(start, end);
            const previousRange = range();
            if (
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
              setScrollElement={setScrollElement}
            />
          )}
        </CalendarEmbed>
        <ScrollIndicators
          scrollRef={scrollElement}
          appearance="gradient"
          noBorderStart
          noBorderEnd
        />

        <Layer depth={4}>
          <div class="absolute right-2 bottom-2 z-anchored-controls flex items-center gap-2">
            <Button
              aria-label="New event"
              label="New event"
              tooltipPlacement="top"
              variant="ghost"
              size="icon-md"
              depth={4}
              class="rounded-lg bg-surface shadow-menu ring ring-edge-muted"
              onClick={() => openEventComposer()}
            >
              <PlusIcon class="size-4" />
            </Button>
            <Dropdown placement="right" gutter={6}>
              <Dropdown.Trigger
                aria-label="Calendar settings"
                label="Calendar settings"
                tooltipPlacement="top"
                variant="ghost"
                size="icon-md"
                depth={4}
                class="rounded-lg bg-surface shadow-menu ring ring-edge-muted"
              >
                <GearIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content
                mount={props.dropdownMount}
                depth={4}
                class="w-56"
              >
                <Dropdown.Group>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <span class="min-w-0 flex-1 truncate">Calendars</span>
                      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent
                      mount={props.dropdownMount}
                      depth={4}
                      class="max-h-52 w-56 overflow-y-auto"
                    >
                      <Dropdown.Group>
                        <For each={sources()}>
                          {(source) => (
                            <Dropdown.CheckboxItem
                              checked={isSourceVisible(source.id)}
                              closeOnSelect={false}
                              onChange={(visible) =>
                                setSourceVisibility(source.id, visible)
                              }
                            >
                              <span
                                aria-hidden="true"
                                class="size-2.5 shrink-0 rounded-sm"
                                style={{ 'background-color': source.color }}
                              />
                              <span class="min-w-0 flex-1 truncate">
                                {source.name}
                              </span>
                            </Dropdown.CheckboxItem>
                          )}
                        </For>
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>

                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <span class="min-w-0 flex-1 truncate">Time format</span>
                      <span class="text-xs text-ink-muted">
                        {timeFormat() === '12-hour' ? '12-hour' : '24-hour'}
                      </span>
                      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent
                      mount={props.dropdownMount}
                      depth={4}
                      class="min-w-36"
                    >
                      <Dropdown.Group>
                        <Dropdown.RadioGroup
                          value={timeFormat()}
                          onChange={(value) =>
                            setTimeFormat(value as CalendarTimeFormat)
                          }
                        >
                          <For each={PREVIEW_TIME_FORMAT_OPTIONS}>
                            {(option) => (
                              <Dropdown.RadioItem
                                closeOnSelect
                                value={option.value}
                              >
                                <span class="flex-1">{option.label}</span>
                                <Dropdown.ItemIndicator>
                                  <CheckIcon class="size-3.5 text-accent" />
                                </Dropdown.ItemIndicator>
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </Layer>

        <Show when={data.isLoading()}>
          <div class="absolute inset-0 bg-surface">
            <PreviewSkeleton />
          </div>
        </Show>
        <Show when={data.occurrencesQuery.isError}>
          <div class="absolute inset-x-3 bottom-3 rounded-lg border border-edge-muted bg-surface p-2 text-center text-xs text-ink-muted shadow-menu">
            Calendar events couldn’t be loaded.
          </div>
        </Show>
      </div>

      <Show when={selectedEvent()}>
        {(event) => (
          <Layer depth={3}>
            <EventSummary
              event={event()}
              onClose={() => setSelectedEventId(undefined)}
              onViewInCalendar={() => void openEventInCalendar(event())}
            />
          </Layer>
        )}
      </Show>
    </div>
  );
}

/** Calendar preview shown while hovering the Calendar sidebar row. */
export function CalendarSidebarPreview(
  props: ParentProps<{ disabled?: boolean }>
) {
  const [open, setOpen] = createSignal(false);
  const [contentElement, setContentElement] = createSignal<HTMLElement>();

  return (
    <HoverCard
      trigger={props.children}
      triggerAs="div"
      triggerClass="w-full"
      triggerTabIndex={-1}
      content={
        <Surface
          depth={2}
          hideBorder
          class="h-[min(24rem,calc(100vh-2rem))] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl shadow-menu ring ring-edge"
        >
          <div
            class="size-full"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <Show when={open() && !props.disabled}>
              <Suspense fallback={<PreviewSkeleton />}>
                <PreviewContent dropdownMount={contentElement()} />
              </Suspense>
            </Show>
          </div>
        </Surface>
      }
      contentClass="max-w-[calc(100vw-1rem)] menu-open-animation"
      contentRef={setContentElement}
      openDelay={300}
      closeDelay={200}
      disabled={props.disabled}
      onOpenChange={setOpen}
      placement="right-start"
      requirePointerMovement
    />
  );
}
