import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createCalendarRsvpController } from './create-calendar-rsvp-controller';

const requests = vi.hoisted(() => [] as unknown[]);
vi.mock('@queries/calendar/mutations', () => ({
  useRsvpCalendarEventMutation: () => ({
    mutate: (args: unknown) => {
      requests.push(args);
    },
    isPending: false,
  }),
}));
it('passes the displayed address through the recurrence scope dialog', () =>
  createRoot((dispose) => {
    requests.length = 0;
    const controller = createCalendarRsvpController(() => ({
      eventId: 'event',
      occurrenceKey: 'original',
      recurring: true,
      respondingEmail: 'chosen@example.com',
    }));
    controller.respond('accepted');
    expect(requests).toHaveLength(0);
    controller.confirmScope();
    expect(requests[0]).toMatchObject({
      respondingEmail: 'chosen@example.com',
      recurrenceId: 'original',
      scope: 'this_event',
    });
    dispose();
  }));
