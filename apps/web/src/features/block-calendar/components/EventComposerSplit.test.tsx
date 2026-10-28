// @vitest-environment jsdom
import type { CalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import type { CalendarEvent } from '@app/features/calendar/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
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
