import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import type { EventEditorInitialValues } from './event-form-model';

const initialValue = (): EventEditorInitialValues => ({
  title: 'Planning',
  allDay: false,
  start: '2026-04-08T09:00',
  end: '2026-04-08T10:30',
  recurrenceLines: [],
  calendarId: undefined,
  guests: '',
  location: '',
  description: '',
});

function withController(
  run: (
    controller: ReturnType<typeof createCalendarEventFormController>
  ) => void,
  onChange = vi.fn()
) {
  createRoot((dispose) => {
    const controller = createCalendarEventFormController({
      initialValue: initialValue(),
      calendarOptions: () => [
        { id: 'calendar-1', label: 'Work', color: '#123456' },
      ],
      guestOptions: () => [],
      onChange,
    });
    try {
      run(controller);
    } finally {
      dispose();
    }
  });
}

describe('createCalendarEventFormController', () => {
  it('publishes user updates and tracks meaningful dirty state', () => {
    const onChange = vi.fn();
    withController((controller) => {
      expect(controller.isDirty()).toBe(false);

      controller.setField('title', 'Updated planning');

      expect(controller.value().title).toBe('Updated planning');
      expect(controller.isDirty()).toBe(true);
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Updated planning' })
      );
    }, onChange);
  });

  it('emits validated submit values with the fallback calendar', () => {
    withController((controller) => {
      expect(controller.submitValues()).toEqual(
        expect.objectContaining({
          title: 'Planning',
          calendarId: 'calendar-1',
          guestEmails: [],
          recurrenceLines: [],
          time: expect.objectContaining({
            kind: 'timed',
            startsAt: new Date('2026-04-08T09:00').toISOString(),
            endsAt: new Date('2026-04-08T10:30').toISOString(),
          }),
        })
      );

      controller.setField('end', '2026-04-08T09:00');

      expect(controller.dateRangeError()).toBe(
        'End time must be after the start time.'
      );
      expect(controller.submitValues()).toBeUndefined();
    });
  });

  it('replaces external values without echoing and resets the baseline', () => {
    const onChange = vi.fn();
    withController((controller) => {
      controller.setField('title', 'Local edit');
      const callsBeforeReplace = onChange.mock.calls.length;

      controller.replaceFromExternal({
        ...initialValue(),
        title: 'AI replacement',
        recurrenceLines: ['RRULE:FREQ=DAILY'],
        guests: 'guest@example.com',
      });

      expect(controller.value()).toMatchObject({
        title: 'AI replacement',
        recurrenceLines: ['RRULE:FREQ=DAILY'],
        guests: 'guest@example.com',
      });
      expect(
        controller.selectedGuests().map((guest) => guest.data.email)
      ).toEqual(['guest@example.com']);
      expect(controller.isDirty()).toBe(false);
      expect(onChange).toHaveBeenCalledTimes(callsBeforeReplace);
    }, onChange);
  });

  it('applies existing all-day conversion policies through commands', () => {
    withController((controller) => {
      controller.setAllDay(true);
      expect(controller.value()).toMatchObject({
        allDay: true,
        start: '2026-04-08',
        end: '2026-04-08',
      });

      controller.setStart('2026-05-02');
      expect(controller.value()).toMatchObject({
        start: '2026-05-02',
        end: '2026-05-02',
      });
    });
  });
});
