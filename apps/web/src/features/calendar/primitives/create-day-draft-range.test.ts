import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../components/composer/create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../components/composer/event-form-model';
import { createCalendarComposer } from './create-calendar-composer';
import { createDayDraftRange } from './create-day-draft-range';

it('synchronizes grid and composer without replacing unrelated edits', async () => {
  const { draft, controller, model, disposeEditor, dispose } = createRoot(
    (dispose) => {
      const draft = createDayDraftRange({
        start: new Date('2030-07-01T13:00:00Z'),
        end: new Date('2030-07-01T14:00:00Z'),
      });
      const controller = createCalendarEventFormController({
        initialValue: {
          ...defaultEditorInitialValues(new Date('2030-07-01T09:00:00'), false),
          start: '2030-07-01T09:00',
          end: '2030-07-01T10:00',
          title: 'Planning',
          guests: 'guest@example.test',
          location: 'Room A',
          calendarId: 'calendar-1',
        },
        calendarOptions: () => [
          { id: 'calendar-1', label: 'Work', color: '#123456' },
          { id: 'calendar-2', label: 'Personal', color: '#abcdef' },
        ],
        guestOptions: () => [],
      });
      const model = createCalendarComposer({
        controller,
        pending: false,
        onSubmit: vi.fn(),
      });
      const disposeEditor = createRoot((disposeEditor) => {
        draft.bind(model);
        return disposeEditor;
      });
      return { draft, controller, model, disposeEditor, dispose };
    }
  );
  await Promise.resolve();
  controller.setField('title', 'Updated');
  controller.setField('location', 'Room B');
  controller.setField('calendarId', 'calendar-2');
  controller.setField('description', 'Notes');
  model.setVisibility('private');
  expect(model.setTimeZone('America/New_York')).toBe(true);
  expect(draft.range()?.start.toISOString()).toBe('2030-07-01T13:00:00.000Z');
  expect(
    draft.resize({
      start: new Date('2030-07-01T14:00:00Z'),
      end: new Date('2030-07-01T16:00:00Z'),
    })
  ).toBe(true);
  expect(controller.state()).toMatchObject({
    start: '2030-07-01T10:00',
    end: '2030-07-01T12:00',
    title: 'Updated',
    location: 'Room B',
    description: 'Notes',
    calendarId: 'calendar-2',
    guests: 'guest@example.test',
  });
  expect(model.visibility()).toBe('private');
  controller.setEnd('2030-07-01T13:00');
  expect(draft.range()?.end.toISOString()).toBe('2030-07-01T17:00:00.000Z');
  expect(
    draft.resize({
      start: new Date('2030-07-01T18:00:00Z'),
      end: new Date('2030-07-01T17:00:00Z'),
    })
  ).toBe(false);
  disposeEditor();
  expect(draft.range()).toBeUndefined();
  expect(
    draft.resize({
      start: new Date('2030-07-01T14:00:00Z'),
      end: new Date('2030-07-01T16:00:00Z'),
    })
  ).toBe(false);
  dispose();
});

it('rejects a nonexistent daylight-saving wall clock', async () => {
  const { draft, dispose } = createRoot((dispose) => {
    const draft = createDayDraftRange({
      start: new Date('2030-03-10T06:00:00Z'),
      end: new Date('2030-03-10T07:00:00Z'),
    });
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-03-10T01:00:00'), false),
        start: '2030-03-10T02:30',
        end: '2030-03-10T03:30',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      onSubmit: vi.fn(),
    });
    draft.bind(model);
    model.setTimeZone('America/New_York');
    return { draft, dispose };
  });
  await Promise.resolve();
  expect(draft.range()).toBeUndefined();
  dispose();
});

it('rejects grid edits while saving or either range field is locked', () => {
  createRoot((dispose) => {
    const [pending, setPending] = createSignal(false);
    const [locked, setLocked] = createSignal(false);
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-07-01T09:00:00'), false),
        start: '2030-07-01T09:00',
        end: '2030-07-01T10:00',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      get pending() {
        return pending();
      },
      get disabledFields() {
        return { end: locked() };
      },
      onSubmit: vi.fn(),
    });
    model.setTimeZone('UTC');
    const next = {
      start: new Date('2030-07-01T08:00:00Z'),
      end: new Date('2030-07-01T11:00:00Z'),
    };
    const draft = createDayDraftRange(next);
    draft.bind(model);
    setPending(true);
    expect(draft.resize(next)).toBe(false);
    expect(controller.state().start).toBe('2030-07-01T09:00');
    setPending(false);
    setLocked(true);
    expect(draft.resize(next)).toBe(false);
    expect(controller.state().end).toBe('2030-07-01T10:00');
    setLocked(false);
    expect(draft.resize(next)).toBe(true);
    expect(controller.state().end).toBe('2030-07-01T11:00');
    dispose();
  });
});
