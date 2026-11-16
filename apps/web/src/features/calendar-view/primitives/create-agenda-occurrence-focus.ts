import type { CalendarEvent } from '@app/features/calendar/types';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import type { CalendarFocusTarget } from '../calendar-focus-target';

type OccurrenceIdentity = Pick<CalendarEvent, 'eventId' | 'occurrenceKey'>;

interface AgendaOccurrenceFocusOptions<T extends OccurrenceIdentity> {
  event: Accessor<T>;
  target: Accessor<CalendarFocusTarget | undefined>;
  element: Accessor<HTMLElement | undefined>;
  focus: (event: T, element: HTMLElement, requestId: number) => void;
  schedule?: (callback: () => void) => () => void;
}

/** Waits for a row's DOM, then rejects superseded targets before focusing it. */
export function createAgendaOccurrenceFocus<T extends OccurrenceIdentity>(
  options: AgendaOccurrenceFocusOptions<T>
) {
  const schedule =
    options.schedule ??
    ((callback: () => void) => {
      const frame = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(frame);
    });
  createEffect(() => {
    const target = options.target();
    const event = options.event();
    const element = options.element();
    if (!target || !element) return;
    if (
      target.eventId !== event.eventId ||
      target.occurrenceKey !== event.occurrenceKey
    )
      return;

    const cancel = schedule(() => {
      const current = options.target();
      const row = options.element();
      const occurrence = options.event();
      if (!current || current.requestId !== target.requestId) return;
      if (!row?.isConnected) return;
      if (
        current.eventId !== occurrence.eventId ||
        current.occurrenceKey !== occurrence.occurrenceKey
      )
        return;
      options.focus(occurrence, row, current.requestId);
    });
    onCleanup(cancel);
  });
}
