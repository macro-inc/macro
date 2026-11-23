import { CalendarComposerHostContext } from '@app/features/calendar/context/calendar-composer-host-context';
import { createCalendarComposerSession } from '@app/features/calendar/primitives/create-calendar-composer-session';
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
} from '@app/features/calendar/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { SelectedEventDetails } from '../../components/SelectedEventDetails';
import { SelectedCalendarEvent } from './SelectedCalendarEvent';

const mocks = vi.hoisted(() => {
  const closes: (() => void)[] = [];
  return { closes };
});
vi.mock('../../components/SelectedEventDetails', () => ({
  SelectedEventDetails: (
    props: ComponentProps<typeof SelectedEventDetails>
  ) => {
    mocks.closes.push(props.onClose);
    return <div data-testid="details">{props.event()?.id}</div>;
  },
}));
afterEach(() => {
  cleanup();
  mocks.closes.length = 0;
});

const EVENT: CalendarEvent = {
  id: 'event-a::2030-01-01',
  eventId: 'event-a',
  occurrenceKey: '2030-01-01',
  isCancelled: false,
  isReadOnly: false,
  guestPolicy: DEFAULT_GUEST_POLICY,
  viewerCan: {
    editDetails: true,
    inviteGuests: true,
    removeGuests: true,
    setGuestPolicy: true,
    rsvp: false,
    organize: true,
  },
  attendees: [],
  recurrenceLines: [],
  title: 'Review',
  start: '2030-01-01T09:00:00Z',
  end: '2030-01-01T10:00:00Z',
  allDay: false,
  sourceCalendarIds: ['calendar'],
  calendarId: 'calendar',
  calendar: {
    id: 'calendar',
    name: 'Calendar',
    color: 'var(--color-blue-ink)',
  },
  visibleCalendars: [],
};

it('ignores a retired detail close callback after a different occurrence is selected', () => {
  const onClose = vi.fn();
  const [event, setEvent] = createSignal<CalendarEvent | undefined>(EVENT);
  render(() => (
    <SelectedCalendarEvent
      boundary={document.body}
      event={event}
      anchor={() => undefined}
      timeFormat={() => '12-hour'}
      onClose={onClose}
    />
  ));
  const closeFirst = mocks.closes[0];
  setEvent({ ...EVENT, id: 'event-b::2030-01-01', eventId: 'event-b' });
  closeFirst();
  expect(onClose).not.toHaveBeenCalled();
  mocks.closes.at(-1)?.();
  expect(onClose).toHaveBeenCalledOnce();
});

it('suppresses only editable details already shown in a pinned or floating editor', async () => {
  const [event, setEvent] = createSignal<CalendarEvent | undefined>(EVENT);
  let setPinned: (value: boolean) => void = () => {};
  let open: () => Promise<void> = async () => {};
  render(() => {
    const sessions = createCalendarComposerSession({
      confirmDiscard: async () => true,
    });
    open = async () => {
      const key = await sessions.open({ event: EVENT });
      if (key === undefined) throw new Error('Expected session');
      setPinned = (value) => sessions.setPinned(key, value);
    };
    return (
      <CalendarComposerHostContext.Provider
        value={{
          sessions,
          canPinComposer: () => true,
          composerPinned: () => sessions.state.pinned,
          boundary: () => undefined,
          dock: () => undefined,
          setDock: () => {},
          drag: () => undefined,
          setDrag: () => {},
          cardPinned: () => false,
          setCardPinned: () => {},
          leftPanelPinned: () => sessions.state.pinned,
          open: sessions.open,
        }}
      >
        <SelectedCalendarEvent
          boundary={document.body}
          event={event}
          anchor={() => undefined}
          timeFormat={() => '12-hour'}
          onClose={() => {}}
        />
      </CalendarComposerHostContext.Provider>
    );
  });
  await open();
  expect(screen.queryByTestId('details')).toBeNull();
  setPinned(true);
  expect(screen.queryByTestId('details')).toBeNull();
  setPinned(false);
  expect(screen.queryByTestId('details')).toBeNull();
  setEvent({ ...EVENT, isReadOnly: true });
  expect(screen.getByTestId('details').textContent).toBe(EVENT.id);
  setEvent({ ...EVENT, id: 'read-only::2030-01-01', isReadOnly: true });
  expect(screen.getByTestId('details').textContent).toBe(
    'read-only::2030-01-01'
  );
});
