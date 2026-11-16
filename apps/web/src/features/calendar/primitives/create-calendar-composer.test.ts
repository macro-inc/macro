import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../components/composer/create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../components/composer/event-form-model';
import { createCalendarComposer } from './create-calendar-composer';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function createController() {
  return createCalendarEventFormController({
    initialValue: {
      ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
      title: 'Planning',
      calendarId: 'calendar-1',
    },
    calendarOptions: () => [
      { id: 'calendar-1', label: 'Calendar', color: '#000000' },
    ],
    guestOptions: () => [],
  });
}

describe('calendar composer model', () => {
  it.each([
    {
      rule: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU',
      expected: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU',
    },
    {
      rule: 'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20300701T235959Z;BYDAY=TU,SU;WKST=SU',
      expected:
        'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20300702T035959Z;BYDAY=TU,SU;WKST=SU',
    },
  ])(
    'preserves biweekly rule semantics when changing time zone: $rule',
    ({ rule, expected }) => {
      createRoot((dispose) => {
        disposers.push(dispose);
        const controller = createCalendarEventFormController({
          initialValue: {
            ...defaultEditorInitialValues(
              new Date('2030-01-01T09:00:00'),
              false
            ),
            title: 'Planning',
            calendarId: 'calendar-1',
            recurrenceLines: [rule],
          },
          isEdit: true,
          recurrenceTimeZone: 'UTC',
          calendarOptions: () => [
            {
              id: 'calendar-1',
              label: 'Calendar',
              color: 'var(--color-accent)',
            },
          ],
          guestOptions: () => [],
        });
        const onSubmit = vi.fn();
        const model = createCalendarComposer({
          controller,
          pending: false,
          isEdit: true,
          initialMetadata: { timeZone: 'UTC' },
          onSubmit,
        });
        expect(controller.recurrenceChoice()).toBe('custom');
        expect(model.setTimeZone('America/New_York')).toBe(true);
        model.submit();
        expect(onSubmit).toHaveBeenCalledOnce();
        expect(onSubmit.mock.lastCall?.[0].recurrenceLines).toEqual([expected]);
      });
    }
  );
  it('blocks a DST-gap submission and recovers when the range is corrected', () => {
    createRoot((dispose) => {
      disposers.push(dispose);
      const controller = createController();
      const onSubmit = vi.fn();
      const model = createCalendarComposer({
        controller,
        pending: false,
        onSubmit,
      });
      controller.setStart('2026-03-08T02:30');
      controller.setEnd('2026-03-08T03:30');
      model.setTimeZone('America/New_York');
      expect(model.timeZoneRangeInvalid()).toBe(true);
      expect(model.canSave()).toBe(false);
      model.submit();
      expect(onSubmit).not.toHaveBeenCalled();
      controller.setStart('2026-03-08T03:30');
      controller.setEnd('2026-03-08T04:30');
      expect(model.timeZoneRangeInvalid()).toBe(false);
      expect(model.canSave()).toBe(true);
      model.submit();
      expect(onSubmit).toHaveBeenCalledOnce();
    });
  });
  it('drops a visibility draft when switching to an unsupported occurrence scope', () => {
    createRoot((dispose) => {
      disposers.push(dispose);
      const onSubmit = vi.fn();
      const model = createCalendarComposer({
        controller: createController(),
        pending: false,
        isEdit: true,
        showRecurringEditNotice: true,
        initialMetadata: { visibility: 'private', timeZone: 'UTC' },
        onSubmit,
      });
      model.setVisibility('public');
      expect(model.isDirty()).toBe(true);
      model.changeEditScope('this_event');
      expect(model.visibility()).toBe('private');
      expect(model.visibilityIsDisabled()).toBe(true);
      model.setVisibility('public');
      model.submit();
      expect(onSubmit.mock.lastCall?.[1]).toBe('this_event');
      expect(onSubmit.mock.lastCall?.[2]).toBeUndefined();
    });
  });

  it('resets metadata with locked event details', () => {
    createRoot((dispose) => {
      disposers.push(dispose);
      const model = createCalendarComposer({
        controller: createController(),
        pending: false,
        initialMetadata: { visibility: 'default', timeZone: 'UTC' },
        onSubmit: vi.fn(),
      });
      model.setVisibility('private');
      expect(model.setTimeZone('America/New_York')).toBe(true);
      expect(model.isDirty()).toBe(true);
      model.resetDetails();
      expect(model.visibility()).toBe('default');
      expect(model.timeZone()).toBe('UTC');
      expect(model.isDirty()).toBe(false);
    });
  });

  it('reacts to pending state without losing the draft or field-level permissions', () => {
    createRoot((dispose) => {
      disposers.push(dispose);
      const [pending, setPending] = createSignal(false);
      const controller = createController();
      const onSubmit = vi.fn();
      const model = createCalendarComposer({
        controller,
        get pending() {
          return pending();
        },
        disabledFields: { title: true },
        onSubmit,
      });
      expect(model.fieldIsDisabled('title')).toBe(true);
      expect(model.fieldIsDisabled('reminders')).toBe(false);
      setPending(true);
      expect(model.fieldIsDisabled('reminders')).toBe(true);
      model.submit();
      expect(onSubmit).not.toHaveBeenCalled();
      setPending(false);
      model.submit();
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(controller.state().title).toBe('Planning');
    });
  });

  it('reports dirty and calendar state to the host without changing the model itself', () => {
    let controller: ReturnType<typeof createController> | undefined;
    const onDirtyChange = vi.fn();
    const onCalendarChange = vi.fn();
    createRoot((dispose) => {
      disposers.push(dispose);
      controller = createController();
      createCalendarComposer({
        controller,
        pending: false,
        onSubmit: vi.fn(),
        onDirtyChange,
        onCalendarChange,
      });
    });
    expect(onCalendarChange).toHaveBeenLastCalledWith('calendar-1', '#000000');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    controller?.setField('title', 'Changed');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
