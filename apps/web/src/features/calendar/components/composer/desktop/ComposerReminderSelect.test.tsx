import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerReminderSelect } from './ComposerReminderSelect';

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderReminders(
  options: {
    disabled?: boolean;
    locked?: boolean;
    minutes?: number[];
    preserved?: number;
    defaults?: number[];
  } = {}
) {
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
        title: 'Planning',
        calendarId: 'primary',
        reminders: options.minutes
          ? {
              useDefault: false,
              overrides: [
                ...options.minutes.map((minutes) => ({
                  method: 'popup' as const,
                  minutes,
                })),
                ...Array.from({ length: options.preserved ?? 0 }, () => ({
                  method: 'email' as const,
                  minutes: 30,
                })),
              ],
            }
          : { useDefault: true },
      },
      calendarOptions: () => [
        {
          id: 'primary',
          label: 'Primary',
          color: '#000000',
          defaultReminders: (options.defaults ?? []).map((minutes) => ({
            method: 'popup' as const,
            minutes,
          })),
        },
      ],
      guestOptions: () => [],
    });
    return (
      <ComposerRoot
        model={createCalendarComposer({
          controller,
          pending: false,
          disabled: options.disabled,
          disabledFields: options.locked ? { reminders: true } : undefined,
          onSubmit: vi.fn(),
        })}
      >
        <ComposerReminderSelect />
      </ComposerRoot>
    );
  });
  return controller;
}

it('toggles multiple presets without closing and retains custom offsets and defaults', async () => {
  const controller = renderReminders({ defaults: [10, 17] });
  const trigger = screen.getByRole('button', { name: 'Reminder' });
  expect(trigger.textContent).toContain('10 minutes before');
  expect(trigger.textContent).toContain('17 minutes before');
  await userEvent.click(trigger);
  const ten = screen.getByRole('menuitemcheckbox', {
    name: '10 minutes before',
  });
  expect(ten.getAttribute('aria-checked')).toBe('true');
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: '17 minutes before' })
      .getAttribute('aria-checked')
  ).toBe('true');
  await userEvent.click(
    screen.getByRole('menuitemcheckbox', { name: '5 minutes before' })
  );
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: '5 minutes before' })
      .getAttribute('aria-checked')
  ).toBe('true');
  await userEvent.click(ten);
  expect(ten.getAttribute('aria-checked')).toBe('false');
  expect(controller.reminderMinutes()).toEqual([5, 17]);
  expect(trigger.textContent).toContain('17 minutes before');
  expect(controller.submitValues()?.reminders).toEqual({
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 5 },
      { method: 'popup', minutes: 17 },
    ],
  });
});

it('keeps selected reminders removable at the limit and preserves non-popup methods', async () => {
  const controller = renderReminders({ minutes: [0, 5, 10, 17], preserved: 1 });
  expect(
    screen.getByText('1 other notification methods are preserved.')
  ).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Reminder' }));
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: '15 minutes before' })
      .hasAttribute('data-disabled')
  ).toBe(true);
  await userEvent.click(
    screen.getByRole('menuitemcheckbox', { name: '17 minutes before' })
  );
  expect(controller.reminderMinutes()).toEqual([0, 5, 10]);
  await userEvent.click(
    screen.getByRole('menuitemcheckbox', { name: '15 minutes before' })
  );
  expect(controller.reminderMinutes()).toEqual([0, 5, 10, 15]);
  expect(controller.submitValues()?.reminders?.overrides).toContainEqual({
    method: 'email',
    minutes: 30,
  });
});

it.each([{ locked: true }, { disabled: true }])(
  'locks reminder editing when permissions or the form disable it: %o',
  async (options) => {
    const controller = renderReminders({ ...options, minutes: [17] });
    const trigger = screen.getByRole('button', { name: 'Reminder' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    expect(controller.reminderMinutes()).toEqual([17]);
  }
);

it('adds a custom reminder offset through the Custom choice', async () => {
  const controller = renderReminders({ minutes: [10] });
  await userEvent.click(screen.getByRole('button', { name: 'Reminder' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Custom' }));
  await userEvent.type(
    screen.getByRole('spinbutton', { name: 'Minutes before event' }),
    '25'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(controller.reminderMinutes()).toEqual([10, 25]);
});

it('focuses Custom input and adds with Enter without closing the menu', async () => {
  const controller = renderReminders({ minutes: [10] });
  await userEvent.click(screen.getByRole('button', { name: 'Reminder' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Custom' }));
  const input = screen.getByRole('spinbutton', {
    name: 'Minutes before event',
  });
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard('25{Enter}');
  expect(controller.reminderMinutes()).toEqual([10, 25]);
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: '25 minutes before' })
      .getAttribute('aria-checked')
  ).toBe('true');
});

it('rejects fractional and negative custom offsets without changing reminders', async () => {
  const controller = renderReminders({ minutes: [10] });
  await userEvent.click(screen.getByRole('button', { name: 'Reminder' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Custom' }));
  const input = screen.getByRole('spinbutton', {
    name: 'Minutes before event',
  });
  await userEvent.type(input, '-5{Enter}');
  expect(controller.reminderMinutes()).toEqual([10]);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  await userEvent.clear(input);
  await userEvent.type(input, '1.5{Enter}');
  expect(controller.reminderMinutes()).toEqual([10]);
  await userEvent.clear(input);
  await userEvent.type(input, '0{Enter}');
  expect(controller.reminderMinutes()).toEqual([0, 10]);
});
