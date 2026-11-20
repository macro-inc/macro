import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createCalendarRsvpController } from './create-calendar-rsvp-controller';

const requests = vi.hoisted(() => [] as unknown[]);
const updating = vi.hoisted(() => new Set<string>());
beforeEach(() => {
  requests.length = 0;
  updating.clear();
});
vi.mock('@queries/calendar/mutations', () => ({
  calendarEventIsUpdating: (eventId: string) => updating.has(eventId),
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

it.each([true, false])(
  'blocks a response during an event update (recurring: %s)',
  (recurring) =>
    createRoot((dispose) => {
      const controller = createCalendarRsvpController(() => ({
        eventId: 'event',
        occurrenceKey: 'original',
        recurring,
      }));
      updating.add('event');
      expect(controller.blocked()).toBe(true);
      controller.respond('accepted');
      controller.confirmScope();
      expect(requests).toHaveLength(0);
      updating.delete('event');
      expect(controller.blocked()).toBe(false);
      controller.respond('accepted');
      if (recurring) controller.confirmScope();
      expect(requests).toHaveLength(1);
      dispose();
    })
);

it('waits through an update that starts with the response scope dialog open', () =>
  createRoot((dispose) => {
    const [target, setTarget] = createSignal({
      eventId: 'event',
      occurrenceKey: 'original',
      recurring: true,
    });
    const controller = createCalendarRsvpController(target);
    controller.respond('declined');
    updating.add('event');
    controller.confirmScope();
    expect(requests).toHaveLength(0);
    expect(controller.scopeOpen()).toBe(true);
    setTarget({
      eventId: 'event',
      occurrenceKey: 'rescheduled',
      recurring: true,
    });
    updating.delete('event');
    controller.confirmScope();
    expect(requests[0]).toMatchObject({
      recurrenceId: 'rescheduled',
      response: 'declined',
    });
    expect(controller.scopeOpen()).toBe(false);
    dispose();
  }));

it('does not block another event while a series updates', () =>
  createRoot((dispose) => {
    updating.add('other-event');
    const controller = createCalendarRsvpController(() => ({
      eventId: 'event',
      occurrenceKey: 'original',
      recurring: false,
    }));
    controller.respond('accepted');
    expect(requests).toHaveLength(1);
    dispose();
  }));
