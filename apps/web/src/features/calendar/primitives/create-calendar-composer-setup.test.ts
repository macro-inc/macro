import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { defaultEditorInitialValues } from '../components/composer/event-form-model';
import { createCalendarComposerSetup } from './create-calendar-composer-setup';

it('keeps host state reactive across the shared controller/model boundary', () =>
  createRoot((dispose) => {
    const [pending, setPending] = createSignal(false);
    const setup = createCalendarComposerSetup(
      {
        form: {
          initialValue: defaultEditorInitialValues(
            new Date('2030-11-13T13:00'),
            false
          ),
          calendarOptions: () => [],
          guestOptions: () => [],
        },
      },
      () => ({
        get pending() {
          return pending();
        },
        onSubmit: vi.fn(),
      })
    );
    expect(setup.model.formIsDisabled()).toBe(false);
    setPending(true);
    expect(setup.model.formIsDisabled()).toBe(true);
    setup.controller.setField('title', 'Draft');
    expect(setup.model.state().title).toBe('Draft');
    dispose();
  }));
