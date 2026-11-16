import type { CalendarEvent } from '@app/features/calendar/types';
import { type Accessor, createMemo } from 'solid-js';

/** Keep an optimistic reply visible until it settles, but never across identity or visibility changes. */
export function createNeedsReplyRows(options: {
  account: Accessor<string | undefined>;
  events: Accessor<readonly CalendarEvent[]>;
  pending: Accessor<boolean>;
  findEvent: (id: string) => CalendarEvent | undefined;
}) {
  const state = createMemo<{
    account: string | undefined;
    events: CalendarEvent[];
  }>((previous) => {
    const account = options.account();
    const pending = options.pending();
    if (!account) return { account, events: [] };
    const currentEvents = options.events();
    const events = new Map<string, CalendarEvent>();
    const sameAccount = previous?.account === account;
    if (sameAccount && pending) {
      for (const event of previous.events) {
        // The source still applies current account and visibility authorization.
        const current = options.findEvent(event.id);
        if (current) events.set(current.id, current);
      }
    }
    for (const event of currentEvents) events.set(event.id, event);
    return { account, events: [...events.values()] };
  });
  return () => state().events;
}
