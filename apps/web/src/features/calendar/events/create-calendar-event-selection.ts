import { batch, createSignal } from 'solid-js';
import type { CalendarEvent } from './types';

/** Owns the selected occurrence and its rendered anchor for a calendar surface. */
export function createCalendarEventSelection() {
  const [selectedEvent, setSelectedEvent] = createSignal<CalendarEvent>();
  const [selectedEventAnchor, setSelectedEventAnchor] =
    createSignal<HTMLElement>();

  const close = () => {
    batch(() => {
      setSelectedEvent(undefined);
      setSelectedEventAnchor(undefined);
    });
  };

  const select = (event: CalendarEvent, anchor: HTMLElement) => {
    batch(() => {
      setSelectedEvent(() => event);
      setSelectedEventAnchor(anchor);
    });
  };

  const refresh = (event: CalendarEvent) => {
    if (selectedEvent()?.id !== event.id) return;
    setSelectedEvent(event);
  };

  return {
    anchor: selectedEventAnchor,
    close,
    event: selectedEvent,
    refresh,
    select,
  };
}
