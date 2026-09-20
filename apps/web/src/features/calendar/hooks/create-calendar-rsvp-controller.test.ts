import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createCalendarRsvpController } from './create-calendar-rsvp-controller';

const requests = vi.hoisted(() => [] as unknown[]);
const calls = vi.hoisted(() => [] as Array<{ onError: () => void }>);
vi.mock('@queries/calendar/mutations', () => ({
  useRsvpCalendarEventMutation: () => ({
    mutate: (args: unknown, callbacks: { onError: () => void }) => {
      requests.push(args);
      calls.push(callbacks);
    },
    isPending: false,
  }),
}));
describe('response feedback ownership', () => {
  it('ignores an older failed request after a newer submission', () =>
    createRoot((dispose) => {
      calls.length = 0;
      const response = createCalendarRsvpController(() => ({
        eventId: 'event',
        occurrenceKey: '2026-09-24',
        recurring: false,
      }));
      response.respond('accepted');
      response.respond('tentative');
      calls[0].onError();
      expect(response.error()).toBeUndefined();
      calls[1].onError();
      expect(response.error()).toContain('try again');
      dispose();
    }));
});

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
