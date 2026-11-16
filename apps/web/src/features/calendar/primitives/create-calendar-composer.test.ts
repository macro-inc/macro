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
