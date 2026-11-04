// @vitest-environment jsdom
import type { CalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventComposerSplit } from './EventComposerSplit';

const mocks = vi.hoisted(() => ({
  flag: () => ({ loading: true, enabled: false }),
  canForward: false,
  controllerEnabled: undefined as (() => boolean) | undefined,
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => mocks.flag(),
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
  }),
}));
vi.mock('@app/features/calendar/components/composer/EventForm', () => ({
  EventForm: (props: {
    controller: CalendarEventFormController;
    guestsAction?: JSX.Element;
  }) => (
    <>
      {props.guestsAction}
      <output aria-label="Conference">
        {props.controller.state().conference}
      </output>
      <output aria-label="Start">{props.controller.state().start}</output>
      <output aria-label="Location">{props.controller.state().location}</output>
      <input
        aria-label="Title"
        value={props.controller.state().title}
        onInput={(event) =>
          props.controller.setField('title', event.currentTarget.value)
        }
      />
    </>
  ),
}));
afterEach(cleanup);

it.each([true, false])(
  'uses the resolved conference default when enabled is %s',
  (enabled) => {
    const [flag, setFlag] = createSignal({ loading: true, enabled: false });
    mocks.flag = flag;
    render(() => <EventComposerSplit />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading event…');
    setFlag({ loading: false, enabled });
    expect(screen.getByLabelText('Conference').textContent).toBe(
      enabled ? 'macro' : 'none'
    );
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Draft title' },
    });
    setFlag({ loading: true, enabled: false });
    setFlag({ loading: false, enabled });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Draft title'
    );
  }
);

const GUEST_COPY = {
  calendar: { id: 'calendar-1', name: 'Calendar', color: 'orange' },
  isCancelled: false,
} as CalendarEvent;

it('offers Forward invitation beside the guests of an event the viewer cannot invite to', () => {
  mocks.flag = () => ({ loading: false, enabled: false });
  mocks.canForward = true;
  render(() => <EventComposerSplit event={GUEST_COPY} />);
  expect(
    screen.getByRole('button', { name: 'Forward invitation' })
  ).toBeTruthy();
  // The forward follows its own flag.
  expect(mocks.controllerEnabled?.()).toBe(true);
});

it('offers no forward while composing a new event', () => {
  mocks.flag = () => ({ loading: false, enabled: false });
  mocks.canForward = true;
  render(() => <EventComposerSplit />);
  expect(
    screen.queryByRole('button', { name: 'Forward invitation' })
  ).toBeNull();
});

it('offers no forward when the viewer may not forward', () => {
  mocks.flag = () => ({ loading: false, enabled: false });
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
  mocks.flag = () => ({ loading: false, enabled: false });
  const { pending, resolve } = suggestion();
  render(() => (
    <EventComposerSplit initialValues={OPENED} suggestedValues={pending} />
  ));
  expect(
    screen.getByText('Reading the email for a time and place…')
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
    screen.queryByText('Reading the email for a time and place…')
  ).toBeNull();
});

it('keeps what the user changed before suggestions arrived', async () => {
  mocks.flag = () => ({ loading: false, enabled: false });
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
      screen.queryByText('Reading the email for a time and place…')
    ).toBeNull()
  );
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'My title'
  );
  expect(screen.getByLabelText('Location').textContent).toBe('');
});
