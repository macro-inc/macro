import { recipientEntityMapper } from '@core/user';
import type { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, createSignal, For } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerGuestSelect } from './ComposerGuestSelect';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span aria-hidden="true" />,
}));

vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (
    props: ComponentProps<typeof PropertyEntitySelector>
  ) => (
    <div>
      <For each={props.config.additionalUsers?.() ?? []}>
        {(user) => (
          <button
            type="button"
            disabled={props.config.excludedIds?.().has(user.id)}
            onClick={() => {
              props.onUserSelected?.(user, false);
              const selected = new Set(props.selectedOptions());
              if (selected.has(user.id)) selected.delete(user.id);
              else selected.add(user.id);
              props.setSelectedOptions(selected);
            }}
          >
            {user.name}
          </button>
        )}
      </For>
    </div>
  ),
}));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderGuests(
  options: {
    initial?: string;
    addOnly?: boolean;
    locked?: boolean;
    disabled?: boolean;
    hidden?: boolean;
    reason?: string;
  } = {}
) {
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    const [suggestions] = createSignal([
      recipientEntityMapper('user')({
        id: 'macro|alex@example.com',
        email: 'alex@example.com',
        name: 'Alex',
      }),
      recipientEntityMapper('user')({
        id: 'macro|blair@example.com',
        email: 'blair@example.com',
        name: 'Blair',
      }),
    ]);
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
        title: 'Planning',
        calendarId: 'primary',
        guests: options.initial ?? '',
      },
      calendarOptions: () => [
        { id: 'primary', label: 'Primary', color: '#000000' },
      ],
      guestOptions: suggestions,
    });
    return (
      <ComposerRoot
        model={createCalendarComposer({
          controller,
          pending: false,
          addOnlyGuests: options.addOnly,
          disabledFields: options.locked ? { guests: true } : undefined,
          disabled: options.disabled,
          guestsReadOnlyReason: options.reason,
          guestListHidden: options.hidden,
          onSubmit: vi.fn(),
        })}
      >
        <ComposerGuestSelect />
      </ComposerRoot>
    );
  });
  return controller;
}

it('adds multiple suggested guests and removes them inside the dropdown without external chips', async () => {
  const controller = renderGuests();
  const trigger = screen.getByRole('button', { name: 'Guests' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Alex' }));
  expect(trigger.textContent).toContain('Alex');
  await userEvent.click(screen.getByRole('button', { name: 'Blair' }));
  expect(trigger.textContent).toContain('Alex, Blair');
  expect(controller.selectedGuests().map((guest) => guest.data.email)).toEqual([
    'alex@example.com',
    'blair@example.com',
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'Alex' }));
  expect(controller.selectedGuests().map((guest) => guest.data.email)).toEqual([
    'blair@example.com',
  ]);
  expect(trigger.textContent).toContain('Blair');
  await userEvent.click(trigger);
  expect(screen.queryByRole('button', { name: 'Remove Blair' })).toBeNull();
});

it('keeps current guests protected while new guests can be removed', async () => {
  const controller = renderGuests({
    initial: 'alex@example.com',
    addOnly: true,
  });
  const trigger = screen.getByRole('button', { name: 'Guests' });
  expect(trigger.textContent).toContain('Alex');
  await userEvent.click(trigger);
  expect(
    screen.getByRole('button', { name: 'Alex' }).hasAttribute('disabled')
  ).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Blair' }));
  expect(trigger.textContent).toContain('Alex, Blair');
  expect(screen.getByRole('list', { name: 'Invited guests' })).toBeTruthy();
  expect(
    screen.getByRole('checkbox', { name: 'Alex' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'Remove Alex' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Blair' }));
  expect(controller.selectedGuests().map((guest) => guest.data.email)).toEqual([
    'alex@example.com',
  ]);
});

it.each([{ locked: true }, { disabled: true }])(
  'keeps guest selection read-only when locked: %o',
  async (options) => {
    const controller = renderGuests({
      initial: 'alex@example.com',
      ...options,
      hidden: true,
      reason: 'Guest edits unavailable',
    });
    const trigger = screen.getByRole('button', { name: 'Guests' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.textContent).toContain('Alex');
    expect(screen.getByText('Guest edits unavailable')).toBeTruthy();
    await userEvent.click(trigger);
    expect(screen.queryByRole('button', { name: 'Blair' })).toBeNull();
    expect(
      controller.selectedGuests().map((guest) => guest.data.email)
    ).toEqual(['alex@example.com']);
  }
);
