// @vitest-environment jsdom
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
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
    handle: { close: vi.fn(), setDisplayName: vi.fn() },
  }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}],
}));
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
      CalendarDesktopPlacement: (props: { children?: JSX.Element }) => {
        const { controller } = useCalendarComposer();
        return (
          <>
            {props.children}
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
afterEach(cleanup);

it('defaults a new event to a Macro call', () => {
  render(() => <EventComposerSplit />);
  expect(screen.getByLabelText('Conference').textContent).toBe('macro');
});

const GUEST_COPY = {
  calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
  isCancelled: false,
} as CalendarEvent;

it('offers Forward invitation beside the guests of an event the viewer cannot invite to', () => {
  mocks.canForward = true;
  render(() => <EventComposerSplit event={GUEST_COPY} />);
  expect(
    screen.getByRole('button', { name: 'Forward invitation' })
  ).toBeTruthy();
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
