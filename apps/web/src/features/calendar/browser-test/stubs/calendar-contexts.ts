import { createSignal } from 'solid-js';
import type { CalendarEvent } from '../../types';

// One mounted calendar's contexts, reduced to what a sidebar list drives:
// the page it asks for and the event it opens.
const [selectedEvent, setSelectedEvent] = createSignal<CalendarEvent>();
const [selectedAnchor, setSelectedAnchor] = createSignal<HTMLElement>();

export function useCalendarPager() {
  return { gotoDate: () => {}, activeDateInfo: () => undefined };
}
export function useCalendarView() {
  return {
    selectedEvent,
    selectedEventAnchor: selectedAnchor,
    selectEvent: (event: CalendarEvent, anchor: HTMLElement) => {
      setSelectedEvent(event);
      setSelectedAnchor(anchor);
    },
    closeEventDetails: () => setSelectedEvent(undefined),
    isSourceVisible: () => false,
    setSourceVisibility: () => {},
    setSourcesVisibility: () => {},
    sources: () => [],
    displaySettings: { weekStartsOn: 0 },
  };
}
export function useCalendarFocus() {
  return { focusOccurrence: () => {}, cancelOccurrence: () => {} };
}
