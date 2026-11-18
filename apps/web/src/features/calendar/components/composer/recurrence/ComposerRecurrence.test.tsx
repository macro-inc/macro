import { cleanup, render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerRecurrence } from './ComposerRecurrence';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('stages a custom repeat until Done and discards cancelled changes', async () => {
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
        title: 'Planning',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    return (
      <ComposerRoot
        model={createCalendarComposer({
          controller,
          pending: false,
          onSubmit: vi.fn(),
        })}
      >
        <ComposerRecurrence />
      </ComposerRoot>
    );
  });
  const before = controller.recurrenceChoice();
  await userEvent.click(screen.getByRole('button', { name: 'Repeats' }));
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Custom repeat' })
  );
  let dialog = screen.getByRole('dialog', { name: 'Custom repeat' });
  const interval = within(dialog).getByRole('spinbutton', {
    name: 'Repeat interval',
  });
  await userEvent.clear(interval);
  await userEvent.type(interval, '3');
  expect(controller.recurrenceChoice()).toBe(before);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(controller.recurrenceChoice()).toBe(before);
  await userEvent.click(screen.getByRole('button', { name: 'Repeats' }));
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Custom repeat' })
  );
  dialog = screen.getByRole('dialog', { name: 'Custom repeat' });
  const next = within(dialog).getByRole('spinbutton', {
    name: 'Repeat interval',
  });
  await userEvent.clear(next);
  expect(
    within(dialog)
      .getByRole('button', { name: 'Done' })
      .hasAttribute('disabled')
  ).toBe(true);
  await userEvent.type(next, '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(controller.recurrenceChoice()).toBe('custom');
  expect(controller.customConfig().interval).toBe(2);
});
