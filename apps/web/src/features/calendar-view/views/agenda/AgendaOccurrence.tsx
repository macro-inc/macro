import { AgendaEventRow } from '@app/features/calendar/components/agenda/AgendaEventRow';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import type { CalendarEvent } from '@app/features/calendar/types';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { useCalendarFocus } from '../../calendar-focus-target';
import { createAgendaOccurrenceFocus } from '../../primitives/create-agenda-occurrence-focus';

/** Resolves route focus and refreshed occurrence data onto one stable agenda row. */
export function AgendaOccurrence(props: { event: CalendarEvent }) {
  const view = useCalendarView();
  const focus = useCalendarFocus();
  const [element, setElement] = createSignal<HTMLDivElement>();
  createAgendaOccurrenceFocus({
    event: () => props.event,
    target: focus.pendingTarget,
    element,
    focus: (event, row, requestId) => {
      focus.consume(requestId);
      row.scrollIntoView({ block: 'nearest' });
      view.selectEvent(event, row, 'agenda');
    },
  });
  createEffect(
    on(
      () => props.event,
      (event) => {
        const anchor = view.selectedEventAnchor();
        if (anchor && element()?.contains(anchor))
          view.refreshSelectedEvent(event);
      }
    )
  );
  onCleanup(() => {
    const anchor = view.selectedEventAnchor();
    if (anchor && element()?.contains(anchor)) view.closeEventDetails();
  });
  return (
    <div ref={setElement} data-agenda-occurrence={props.event.id}>
      <AgendaEventRow
        event={props.event}
        timeFormat={view.displaySettings.timeFormat}
        selected={view.selectedEvent()?.id === props.event.id}
        onSelect={(row) => view.selectEvent(props.event, row, 'agenda')}
      />
    </div>
  );
}
