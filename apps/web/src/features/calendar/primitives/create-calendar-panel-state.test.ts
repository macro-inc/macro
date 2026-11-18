import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { type CalendarEvent, DEFAULT_GUEST_POLICY } from '../types';
import { createCalendarComposerSession } from './create-calendar-composer-session';
import { createCalendarPanelState } from './create-calendar-panel-state';

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
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function setup(confirmDiscard: () => Promise<boolean> = async () => true) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [event, setEvent] = createSignal<CalendarEvent | undefined>(EVENT);
    const sessions = createCalendarComposerSession({ confirmDiscard });
    const panels = createCalendarPanelState({
      event,
      sessions,
      open: sessions.open,
    });
    return { setEvent, sessions, panels };
  });
}
it('keeps the sidebar pinned when a card becomes an editor, even after selection closes', async () => {
  const { panels, sessions, setEvent } = setup();
  expect(await panels.pinCard()).toBe(true);
  const opening = panels.open({ event: EVENT });
  setEvent(undefined);
  const key = await opening;
  expect(key).toBeDefined();
  expect(sessions.state.pinned).toBe(true);
  expect(panels.cardPinned()).toBe(false);
  expect(panels.leftPanelPinned()).toBe(true);
});
it('does not replace a dirty editor with a pinned card when discard is rejected', async () => {
  const { panels, sessions } = setup(async () => false);
  const key = await sessions.open({});
  if (key === undefined) throw new Error('Expected editor');
  sessions.setDirty(key, true);
  expect(await panels.pinCard()).toBe(false);
  expect(sessions.state.session?.key).toBe(key);
  expect(panels.cardPinned()).toBe(false);
});
it('does not pin a different card after waiting for discard approval', async () => {
  let approve!: (value: boolean) => void;
  const approval = new Promise<boolean>((resolve) => {
    approve = resolve;
  });
  const { panels, sessions, setEvent } = setup(() => approval);
  const key = await sessions.open({});
  if (key === undefined) throw new Error('Expected editor');
  sessions.setDirty(key, true);
  const pinning = panels.pinCard();
  setEvent({ ...EVENT, id: 'event-b' });
  approve(true);
  expect(await pinning).toBe(false);
  expect(panels.cardPinned()).toBe(false);
});

it('cancels a pending pin request when explicitly unpinned during discard confirmation', async () => {
  let approve!: (value: boolean) => void;
  const approval = new Promise<boolean>((resolve) => {
    approve = resolve;
  });
  const { panels, sessions } = setup(() => approval);
  const key = await sessions.open({});
  if (key === undefined) throw new Error('Expected editor');
  sessions.setDirty(key, true);
  const pinning = panels.pinCard();
  panels.setCardPinned(false);
  approve(true);
  expect(await pinning).toBe(false);
  expect(panels.cardPinned()).toBe(false);
});

it('keeps the sidebar pinned while selecting another card', async () => {
  const { panels, setEvent } = setup();
  await panels.pinCard();
  setEvent({ ...EVENT, id: 'event-b' });
  expect(panels.cardPinned()).toBe(true);
  expect(panels.leftPanelPinned()).toBe(true);
});
