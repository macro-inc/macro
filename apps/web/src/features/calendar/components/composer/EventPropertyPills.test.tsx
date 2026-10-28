/**
 * @vitest-environment jsdom
 */

import { recipientEntityMapper } from '@core/user';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@ui';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventDateTimeRangeFields } from './EventDateTimeRangeFields';
import {
  EventComposerConferencePill,
  EventComposerGuestsPill,
  EventComposerLocationPill,
} from './EventPropertyPills';
import type {
  EventEditorConferenceChoice,
  EventEditorGuestOption,
  SelectedEventEditorGuest,
} from './event-form-model';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'user-avatar');
    return el;
  },
}));

// Stands in for the shared picker: offers every pool member it is not told
// to exclude, and toggles the clicked one.
vi.mock('@property/editors/selectors/PropertyEntitySelector', async () => {
  const { createRenderEffect } = await import('solid-js');
  return {
    PropertyEntitySelector: (props: {
      config: {
        placeholder: string;
        users?: () => { id: string; name: string }[];
        excludedIds?: () => ReadonlySet<string>;
      };
      selectedOptions: () => Set<string>;
      setSelectedOptions: (ids: Set<string>) => void;
    }) => {
      const root = document.createElement('div');
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Search for guests');
      input.setAttribute('placeholder', props.config.placeholder);
      const suggestions = document.createElement('div');
      root.append(input, suggestions);
      createRenderEffect(() => {
        const excluded = props.config.excludedIds?.() ?? new Set();
        suggestions.replaceChildren(
          ...(props.config.users?.() ?? [])
            .filter((user) => !excluded.has(user.id))
            .map((user) => {
              const option = document.createElement('button');
              option.type = 'button';
              option.textContent = `Suggest ${user.name}`;
              option.addEventListener('click', () => {
                const next = new Set(props.selectedOptions());
                if (next.has(user.id)) next.delete(user.id);
                else next.add(user.id);
                props.setSelectedOptions(next);
              });
              return option;
            })
        );
      });
      return root;
    },
  };
});

function guest(email: string, name: string): EventEditorGuestOption {
  return recipientEntityMapper('user')({
    id: `macro|${email}`,
    email,
    name,
  });
}

function renderInComposerDialog() {
  const [selected, setSelected] = createSignal<SelectedEventEditorGuest[]>([]);

  render(() => (
    <Dialog open>
      <input aria-label="Title" />
      <EventComposerGuestsPill
        options={() => [guest('ada@example.com', 'Ada Lovelace')]}
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

class WebSocketStub {
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IntersectionObserver', ResizeObserverStub);
  vi.stubGlobal('WebSocket', WebSocketStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});

describe('composer popovers inside a dialog', () => {
  it('focuses the location input and preserves changes when reopened', async () => {
    const user = userEvent.setup();
    render(() => {
      const [location, setLocation] = createSignal('');
      return (
        <Dialog open>
          <input aria-label="Title" />
          <EventComposerLocationPill
            value={location()}
            onChange={setLocation}
          />
        </Dialog>
      );
    });
    screen.getByLabelText('Title').focus();
    const trigger = screen.getByRole('button', { name: 'Location' });
    await user.click(trigger);
    const input = screen.getByRole('textbox', { name: 'Location' });
    expect(document.activeElement).toBe(input);
    await user.type(input, 'Meeting room');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(
      (screen.getByRole('textbox', { name: 'Location' }) as HTMLInputElement)
        .value
    ).toBe('Meeting room');
  });

  it('selects a nested time without dismissing the date picker or composer', async () => {
    const user = userEvent.setup();
    render(() => {
      const [start, setStart] = createSignal('2026-10-06T09:00');
      return (
        <Dialog open>
          <input aria-label="Title" />
          <EventDateTimeRangeFields
            start={start()}
            end="2026-10-06T10:00"
            allDay={false}
            onStartChange={setStart}
            onEndChange={vi.fn()}
            onAllDayChange={vi.fn()}
          />
        </Dialog>
      );
    });
    screen.getByLabelText('Title').focus();
    const trigger = screen.getByRole('button', {
      name: 'Edit event start date and time',
    });
    await user.click(trigger);
    const time = screen.getByLabelText('Start time');
    await user.click(time);
    await user.click(screen.getByRole('option', { name: '9:30 AM' }));
    expect((time as HTMLInputElement).value).toBe('09:30');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Title')).toBeTruthy();
  });
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
    const guests = screen.getByRole('button', { name: 'Guests' });
    await user.click(guests);

    // The property dropdown is modal, so the composer dialog (and this
    // trigger) is aria-hidden while the list is open.
    expect(guests.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByPlaceholderText('Add guests...')).toBeTruthy();
  });
});

describe('EventComposerGuestsPill for a guest who may only add guests', () => {
  it('keeps the current guests fixed and adds or drops new ones', async () => {
    const user = userEvent.setup();
    const host = guest('host@example.com', 'Host Person');
    const [selected, setSelected] = createSignal<SelectedEventEditorGuest[]>([
      host,
    ]);
    render(() => (
      <Dialog open>
        <input aria-label="Title" />
        <EventComposerGuestsPill
          options={() => [host, guest('ada@example.com', 'Ada Lovelace')]}
          selected={selected()}
          currentGuests={[host]}
          onChange={setSelected}
        />
      </Dialog>
    ));
    screen.getByLabelText('Title').focus();

    await user.click(screen.getByRole('button', { name: 'Guests' }));
    expect(
      screen.getByRole('list', { name: 'Invited guests' }).textContent
    ).toContain('Host Person');
    expect(
      screen.queryByRole('button', { name: 'Remove Host Person' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Suggest Host Person' })
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Suggest Ada Lovelace' })
    );
    expect(selected().map((selectedGuest) => selectedGuest.data.email)).toEqual(
      ['host@example.com', 'ada@example.com']
    );
    expect(
      screen.getByRole('list', { name: 'New guests' }).textContent
    ).toContain('Ada Lovelace');

    await user.click(
      screen.getByRole('button', { name: 'Remove Ada Lovelace' })
    );
    expect(selected().map((selectedGuest) => selectedGuest.data.email)).toEqual(
      ['host@example.com']
    );
  });

  it('explains a read-only guest list inside its popover', async () => {
    const user = userEvent.setup();
    render(() => (
      <EventComposerGuestsPill
        options={() => []}
        selected={[guest('host@example.com', 'Host Person')]}
        onChange={vi.fn()}
        readOnly
        readOnlyReason="Only the organizer can invite guests."
      />
    ));

    await user.click(screen.getByRole('button', { name: 'Guests' }));
    expect(
      screen.getByText('Only the organizer can invite guests.')
    ).toBeTruthy();
  });

  it('names a hidden guest list instead of claiming there are no guests', async () => {
    const user = userEvent.setup();
    render(() => (
      <EventComposerGuestsPill
        options={() => []}
        selected={[]}
        onChange={vi.fn()}
        readOnly
        readOnlyReason="Guests cannot be added while the organizer hides the guest list."
        guestListHidden
      />
    ));

    const pill = screen.getByRole('button', { name: 'Guest list hidden' });
    expect(pill.textContent).toContain('Guest list hidden');
    await user.click(pill);
    expect(
      screen.getByText(
        'Guests cannot be added while the organizer hides the guest list.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('No guests')).toBeNull();
  });
});

describe('EventComposerConferencePill', () => {
  it('offers Macro only after the host flag resolves enabled', async () => {
    const user = userEvent.setup();
    const [enabled, setEnabled] = createSignal(false);
    render(() => (
      <EventComposerConferencePill
        value="none"
        macroCallsEnabled={enabled()}
        canKeepExisting={false}
        onChange={vi.fn()}
      />
    ));
    await user.click(
      screen.getByRole('button', { name: /Video conferencing/ })
    );
    expect(screen.queryByRole('option', { name: 'Macro call' })).toBeNull();
    setEnabled(true);
    expect(
      await screen.findByRole('option', { name: 'Macro call' })
    ).toBeTruthy();
    setEnabled(false);
    expect(screen.queryByRole('option', { name: 'Macro call' })).toBeNull();
  });

  it('shows the Macro selection and lets users switch to no link or Google Meet inside the composer dialog', async () => {
    const user = userEvent.setup();
    render(() => {
      const [choice, setChoice] =
        createSignal<EventEditorConferenceChoice>('macro');
      return (
        <Dialog open>
          <input aria-label="Title" />
          <EventComposerConferencePill
            value={choice()}
            macroCallsEnabled
            canKeepExisting={false}
            onChange={setChoice}
          />
        </Dialog>
      );
    });
    const trigger = screen.getByRole('button', {
      name: /Video conferencing/,
    });
    expect(trigger.textContent).toContain('Macro call');
    screen.getByLabelText('Title').focus();
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'No meeting link' }));
    expect(trigger.textContent).toContain('Add meeting link');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Google Meet' }));
    expect(trigger.textContent).toContain('Google Meet');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Macro call' }));
    expect(trigger.textContent).toContain('Macro call');
  });

  it('keeps its selection to itself while the form around it changes', async () => {
    const onChange = vi.fn();
    const [edits, setEdits] = createSignal(0);
    render(() => (
      <EventComposerConferencePill
        value="macro"
        // The real provider arrives through the selected calendar, which the
        // composer rereads on every edit even when the answer is the same.
        provider={edits() >= 0 ? 'google_meet' : null}
        macroCallsEnabled
        canKeepExisting={false}
        onChange={onChange}
      />
    ));
    setEdits(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not offer a new Macro call when calls are unavailable', async () => {
    const user = userEvent.setup();
    render(() => (
      <EventComposerConferencePill
        value="none"
        macroCallsEnabled={false}
        canKeepExisting={false}
        onChange={vi.fn()}
      />
    ));
    await user.click(
      screen.getByRole('button', { name: /Video conferencing/ })
    );
    expect(screen.queryByRole('option', { name: 'Macro call' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Google Meet' })).toBeTruthy();
  });
});
