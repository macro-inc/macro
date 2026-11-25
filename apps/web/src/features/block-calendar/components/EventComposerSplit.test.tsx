// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventComposerSplit } from './EventComposerSplit';

const mocks = vi.hoisted(() => ({
  canForward: false,
  controllerEnabled: undefined as (() => boolean) | undefined,
  close: vi.fn(),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarGuestInvitesFlag: () => () => false,
  useCalendarInvitationForwardFlag: () => () => true,
}));
vi.mock('@app/features/calendar/hooks/create-guest-invite-controller', () => ({
  createGuestInviteController: (
    _event: unknown,
    _enabled: () => boolean,
    forwardEnabled: () => boolean
  ) => {
    mocks.controllerEnabled = forwardEnabled;
    return { canForward: () => mocks.canForward };
  },
}));
vi.mock('@app/features/calendar-view/components/EventGuests', () => ({
  EventForwardInvitationAction: () => (
    <button type="button">Forward invitation</button>
  ),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { close: mocks.close, setDisplayName: vi.fn() },
  }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@app/features/calendar/hooks/use-synced-calendar-event', () => ({
  useSyncedCalendarEvent: () => () => undefined,
}));
vi.mock('@app/features/calendar/hooks/use-event-editor', () => ({
  useEventEditor: () => ({
    initialValues: () => undefined,
    calendarOptions: () => [],
    guestOptions: () => [],
    pending: () => false,
    saveError: () => undefined,
    disabledFields: () => ({}),
    addOnlyGuests: () => false,
    guestsReadOnlyReason: () => undefined,
    guestListHidden: () => false,
    guestPolicyEditable: () => false,
    detailsReadOnlyReason: () => undefined,
    showRecurringEditNotice: () => false,
    replacementRequest: () => undefined,
  }),
}));
vi.mock('@app/features/calendar/views/event-replacement', () => ({
  useEventReplacement: () => ({ start: vi.fn() }),
  EventReplacement: () => null,
}));
vi.mock(
  '@app/features/calendar/views/composer/CalendarDesktopPlacement',
  async () => {
    const { useCalendarComposer } = await import(
      '@app/features/calendar/context/calendar-composer-context'
    );
    return {
      CalendarDesktopPlacement: (props: {
        children?: JSX.Element;
        footerLeading?: JSX.Element;
        onClose: () => void;
      }) => {
        const { controller } = useCalendarComposer();
        return (
          <>
            {props.children}
            <footer>{props.footerLeading}</footer>
            <button type="button" onClick={props.onClose}>
              Cancel
            </button>
            <output aria-label="Conference">
              {controller.state().conference}
            </output>
            <output aria-label="Start">{controller.state().start}</output>
            <output aria-label="Location">{controller.state().location}</output>
            <input
              aria-label="Title"
              value={controller.state().title}
              onInput={(event) =>
                controller.setField('title', event.currentTarget.value)
              }
            />
          </>
        );
      },
    };
  }
);
afterEach(() => {
  cleanup();
  setActiveScope('global');
  setPressedKeys(new Set<string>());
  mocks.close.mockClear();
});

it('defaults a new event to a Macro call', () => {
  render(() => <EventComposerSplit />);
  expect(screen.getByLabelText('Conference').textContent).toBe('macro');
});

const GUEST_COPY = {
  calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
  isCancelled: false,
} as CalendarEvent;

it('offers Forward invitation in the footer of an event the viewer cannot invite to', () => {
  mocks.canForward = true;
  render(() => <EventComposerSplit event={GUEST_COPY} />);
  expect(
    screen.getByRole('button', { name: 'Forward invitation' }).closest('footer')
  ).not.toBeNull();
  // The forward follows its own flag.
  expect(mocks.controllerEnabled?.()).toBe(true);
});

it('offers no forward while composing a new event', () => {
  mocks.canForward = true;
  render(() => <EventComposerSplit />);
  expect(
    screen.queryByRole('button', { name: 'Forward invitation' })
  ).toBeNull();
});

it('offers no forward when the viewer may not forward', () => {
  mocks.canForward = false;
  render(() => <EventComposerSplit event={GUEST_COPY} />);
  expect(
    screen.queryByRole('button', { name: 'Forward invitation' })
  ).toBeNull();
});

const OPENED: EventEditorInitialValues = {
  title: 'Planning',
  allDay: false,
  start: '2030-01-07T10:00',
  end: '2030-01-07T11:00',
  recurrenceLines: [],
  guests: 'alice@example.com',
  location: '',
  description: '',
  conference: 'none',
};

function suggestion() {
  let resolve!: (values: Partial<EventEditorInitialValues>) => void;
  const pending = new Promise<Partial<EventEditorInitialValues>>((settle) => {
    resolve = settle;
  });
  return { pending, resolve };
}

it('fills an untouched new event with values suggested after it opened', async () => {
  const { pending, resolve } = suggestion();
  render(() => (
    <EventComposerSplit initialValues={OPENED} suggestedValues={pending} />
  ));
  expect(
    screen.getByText('Reading the email for a time and place')
  ).toBeTruthy();

  resolve({
    title: 'Q1 planning',
    start: '2030-01-08T14:00',
    end: '2030-01-08T15:00',
    location: 'Room 4',
  });

  await waitFor(() =>
    expect(screen.getByLabelText('Location').textContent).toBe('Room 4')
  );
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Q1 planning'
  );
  expect(screen.getByLabelText('Start').textContent).toBe('2030-01-08T14:00');
  expect(
    screen.queryByText('Reading the email for a time and place')
  ).toBeNull();
});

it('keeps what the user changed before suggestions arrived', async () => {
  const { pending, resolve } = suggestion();
  render(() => (
    <EventComposerSplit initialValues={OPENED} suggestedValues={pending} />
  ));
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'My title' },
  });

  resolve({ title: 'Q1 planning', location: 'Room 4' });

  await waitFor(() =>
    expect(
      screen.queryByText('Reading the email for a time and place')
    ).toBeNull()
  );
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'My title'
  );
  expect(screen.getByLabelText('Location').textContent).toBe('');
});

it('closes on cancel without calling the save callback', () => {
  const onSaveSuccess = vi.fn();
  render(() => <EventComposerSplit onSaveSuccess={onSaveSuccess} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(onSaveSuccess).not.toHaveBeenCalled();
});

// The composer opens in a popover split, under the app's global hotkeys. A
// global shortcut such as Ctrl+; (toggle settings) must still run from its
// fields and claim the key, or WebKitGTK's own Ctrl+; opens its emoji picker.
it('runs global hotkeys from its fields', () => {
  const toggleSettings = vi.fn(() => true);
  render(() => {
    useHotKeyRoot();
    const [attachPopoverScope] = useHotkeyDOMScope('popover-split');
    registerHotkey({
      hotkey: 'cmd+;',
      scopeId: 'global',
      description: 'Toggle settings',
      keyDownHandler: toggleSettings,
      runWithInputFocused: true,
    });
    return (
      <div ref={attachGlobalDOMScope}>
        <div ref={attachPopoverScope}>
          <EventComposerSplit />
        </div>
      </div>
    );
  });
  const title = screen.getByRole('textbox');
  title.focus();

  const keydown = new KeyboardEvent('keydown', {
    key: ';',
    code: 'Semicolon',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  title.dispatchEvent(keydown);

  expect(toggleSettings).toHaveBeenCalledTimes(1);
  expect(keydown.defaultPrevented).toBe(true);
});
