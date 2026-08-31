/**
 * @vitest-environment jsdom
 */

import { recipientEntityMapper } from '@core/user';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@ui';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventComposerGuestsPill } from './EventPropertyPills';
import type {
  EventEditorGuestOption,
  SelectedEventEditorGuest,
} from './event-form-model';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <div data-testid="user-avatar" />,
}));

function guest(email: string, name: string): EventEditorGuestOption {
  return recipientEntityMapper('user')({
    id: `macro|${email}`,
    email,
    name,
  });
}

const OPTIONS = [
  guest('ada@example.com', 'Ada Lovelace'),
  guest('grace@example.com', 'Grace Hopper'),
];

function renderInComposerDialog() {
  const [selected, setSelected] = createSignal<SelectedEventEditorGuest[]>([]);

  render(() => (
    <Dialog open>
      <input aria-label="Title" />
      <EventComposerGuestsPill
        options={() => OPTIONS}
        selected={selected()}
        onChange={setSelected}
      />
    </Dialog>
  ));
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EventComposerGuestsPill', () => {
  it('opens the guest list on the first click from the title field', async () => {
    const user = userEvent.setup();
    renderInComposerDialog();

    screen.getByLabelText('Title').focus();
    const trigger = screen.getByRole('button', { name: 'Guests' });
    await user.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(screen.getByRole('dialog')).getByRole('listbox')
    ).toBeTruthy();
    const search = screen.getByRole('combobox', { name: 'Search for guests' });
    expect(document.activeElement).toBe(search);

    await user.click(search);
    expect(document.activeElement).toBe(search);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('restores search focus when the dialog steals focus', async () => {
    const user = userEvent.setup();
    renderInComposerDialog();

    const trigger = screen.getByRole('button', { name: 'Guests' });
    await user.click(trigger);

    screen.getByRole('dialog').focus();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: 'Search for guests' })
    );
  });

  it('closes the guest list when focus moves to the title', async () => {
    const user = userEvent.setup();
    renderInComposerDialog();

    const trigger = screen.getByRole('button', { name: 'Guests' });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.click(screen.getByLabelText('Title'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
