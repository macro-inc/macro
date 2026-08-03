import { SidePanel, useSidePanel } from '@components/app/side-panel/SidePanel';
import CloseIcon from '@phosphor/x.svg';
import { Button, Calendar as MiniCalendar } from '@ui';
import { createEffect, on, Show } from 'solid-js';
import { CalendarControls } from './events/CalendarControls';
import { EventDetails } from './events/EventDetails';
import { EventEditor } from './events/EventEditor';
import type {
  CalendarEvent,
  CalendarSource,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './events/types';

interface CalendarSidePanelSectionsProps {
  currentDate: Date;
  focusedDay: Date;
  highlightedRange: { start: Date; end: Date } | undefined;
  selectedEvent: CalendarEvent | undefined;
  draftEventId: string | undefined;
  sources: CalendarSource[];
  timeFormat: CalendarTimeFormat;
  weekStartsOn: CalendarWeekStart;
  isSourceVisible: (sourceId: string) => boolean;
  onCloseEvent: () => void;
  onSaveDraftEvent: (event: CalendarEvent) => void;
  onFocusedDayChange: (date: Date) => void;
  onMonthChange: (date: Date) => void;
  onSelectDate: (date: Date | null) => void;
  onSourceVisibilityChange: (sourceId: string, visible: boolean) => void;
}

/** Registers the calendar's contextual right-side panel sections. */
export function CalendarSidePanelSections(
  props: CalendarSidePanelSectionsProps
) {
  const sidePanel = useSidePanel();

  createEffect(
    on(
      () => [props.selectedEvent?.id, sidePanel?.isNarrow()] as const,
      ([eventId, isNarrow]) => {
        if (!eventId || !sidePanel || isNarrow) return;

        sidePanel.setIsOpen(true);
        if (!sidePanel.openSectionIds().includes('calendar-event')) {
          sidePanel.setOpenSectionIds([
            ...sidePanel.openSectionIds(),
            'calendar-event',
          ]);
        }
      }
    )
  );

  return (
    <Show when={!sidePanel?.isNarrow()}>
      <Show when={props.selectedEvent}>
        {(event) => (
          <SidePanel.Section
            id="calendar-event"
            title={props.draftEventId === event().id ? 'New event' : 'Event'}
            order={0}
            defaultOpen
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                label="Close event details"
                onClick={props.onCloseEvent}
              >
                <CloseIcon class="size-3.5" />
              </Button>
            }
          >
            <Show
              when={props.draftEventId === event().id}
              fallback={
                <EventDetails event={event()} timeFormat={props.timeFormat} />
              }
            >
              <EventEditor
                event={event()}
                sources={props.sources}
                onCancel={props.onCloseEvent}
                onSave={props.onSaveDraftEvent}
              />
            </Show>
          </SidePanel.Section>
        )}
      </Show>

      <SidePanel.Section
        id="calendar-mini-calendar"
        title="Calendar"
        order={10}
        defaultOpen
      >
        <MiniCalendar
          required
          fixedWeeks
          startOfWeek={props.weekStartsOn}
          value={props.currentDate}
          month={props.currentDate}
          focusedDay={props.focusedDay}
          highlightedRange={props.highlightedRange}
          onMonthChange={props.onMonthChange}
          onFocusedDayChange={props.onFocusedDayChange}
          onValueChange={props.onSelectDate}
        />
      </SidePanel.Section>

      <SidePanel.Section
        id="calendar-controls"
        title="Calendars"
        order={20}
        defaultOpen
      >
        <CalendarControls
          sources={props.sources}
          isVisible={props.isSourceVisible}
          onVisibilityChange={props.onSourceVisibilityChange}
        />
      </SidePanel.Section>
    </Show>
  );
}
