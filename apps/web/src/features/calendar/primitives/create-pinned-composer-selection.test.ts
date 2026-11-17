import { createComputed, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComposerOpenRequest } from '../core/composer-session';
import { type CalendarEvent, DEFAULT_GUEST_POLICY } from '../types';
import { createCalendarComposerSession } from './create-calendar-composer-session';
import { createPinnedComposerSelection } from './create-pinned-composer-selection';

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
const NEXT: CalendarEvent = {
  ...EVENT,
  id: 'event-b::2030-01-01',
  eventId: 'event-b',
};
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function setup(
  confirmDiscard: () => Promise<boolean> = async () => true
) {
  const fixture = createRoot((dispose) => {
    disposers.push(dispose);
    const [selected, select] = createSignal<CalendarEvent>();
    const [enabled, setEnabled] = createSignal(true);
    const sessions = createCalendarComposerSession({ confirmDiscard });
    const requests: Promise<number | undefined>[] = [];
    const replace = vi.fn(
      (key: number, resolve: () => ComposerOpenRequest | undefined) => {
        const request = sessions.replacePinned(key, resolve);
        requests.push(request);
        return request;
      }
    );
    const pinStates: boolean[] = [];
    createComputed(() => {
      pinStates.push(sessions.state.pinned);
    });
    const selection = createPinnedComposerSelection({
      event: selected,
      anchor: () => undefined,
      enabled,
      pinnedSession: () =>
        sessions.state.pinned ? sessions.state.session : undefined,
      replacePinned: replace,
      open: sessions.open,
    });
    return {
      sessions,
      select,
      setEnabled,
      requests,
      replace,
      pinStates,
      dispose,
      open: selection.open,
    };
  });
  const key = await fixture.sessions.open({ event: EVENT });
  if (key === undefined) throw new Error('Expected initial session');
  fixture.sessions.setPinned(key, true);
  fixture.pinStates.length = 0;
  return { ...fixture, key };
}

it('switches to the latest selected occurrence after one discard decision without collapsing the dock', async () => {
  const decision = Promise.withResolvers<boolean>();
  const confirm = vi.fn(() => decision.promise);
  const { sessions, select, requests, key, pinStates } = await setup(confirm);
  sessions.setDirty(key, true);
  select(NEXT);
  const latest = { ...NEXT, id: 'event-c::2030-01-01', eventId: 'event-c' };
  select(latest);
  expect(sessions.state.session?.key).toBe(key);
  decision.resolve(true);
  const nextKey = await requests[0];
  expect(nextKey).not.toBe(key);
  expect(sessions.state.session?.request.event).toEqual(latest);
  expect(sessions.state.pinned).toBe(true);
  expect(pinStates).not.toContain(false);
  expect(confirm).toHaveBeenCalledOnce();
  if (nextKey === undefined) throw new Error('Expected replacement session');
  sessions.setDirty(nextKey, true);
  sessions.markSaved(key);
  expect(sessions.hasUnsavedChanges()).toBe(true);
});

it('keeps the old editor and pin state when discard is cancelled', async () => {
  const confirm = vi.fn(async () => false);
  const { sessions, select, requests, key } = await setup(confirm);
  const previous = sessions.state.session;
  sessions.setDirty(key, true);
  select(NEXT);
  expect(await requests[0]).toBeUndefined();
  expect(sessions.state.session).toBe(previous);
  expect(sessions.state.pinned).toBe(true);
  expect(confirm).toHaveBeenCalledOnce();
});

it('does not reset a dirty draft on same-occurrence refresh', async () => {
  const confirm = vi.fn(async () => true);
  const { sessions, select, requests, key } = await setup(confirm);
  sessions.setDirty(key, true);
  select(EVENT);
  expect(await requests[0]).toBe(key);
  select({ ...EVENT, title: 'Refreshed metadata' });
  expect(requests).toHaveLength(1);
  expect(sessions.state.session?.key).toBe(key);
  expect(sessions.hasUnsavedChanges()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

it('distinguishes two occurrences of the same series', async () => {
  const { sessions, select, requests, key } = await setup();
  const occurrence = {
    ...EVENT,
    id: 'event-a::2030-01-02',
    occurrenceKey: '2030-01-02',
  };
  select(occurrence);
  expect(await requests[0]).not.toBe(key);
  expect(sessions.state.session?.request.event?.eventId).toBe(EVENT.eventId);
  expect(sessions.state.session?.request.event?.occurrenceKey).toBe(
    '2030-01-02'
  );
});

it.each([
  { isReadOnly: true },
  { isCancelled: true },
  { isSnapshot: true },
  { teamProjection: { ownerId: 'owner', kind: 'busy' as const } },
])(
  'leaves ineligible selections on their existing detail path: %j',
  async (restriction) => {
    const { sessions, select, requests, key } = await setup();
    select({ ...NEXT, ...restriction });
    expect(requests).toHaveLength(0);
    expect(sessions.state.session?.key).toBe(key);
  }
);

it('does not route selections while disabled or unpinned', async () => {
  const { sessions, select, setEnabled, requests, key } = await setup();
  setEnabled(false);
  select(NEXT);
  setEnabled(true);
  sessions.setPinned(key, false);
  select({ ...NEXT, id: 'event-c' });
  expect(requests).toHaveLength(0);
  expect(sessions.state.session?.key).toBe(key);
});

it.each(['clear', 'readonly', 'original', 'unpin', 'close', 'dispose'])(
  'does not commit obsolete approval after %s',
  async (change) => {
    const decision = Promise.withResolvers<boolean>();
    const { sessions, select, requests, key, dispose } = await setup(
      () => decision.promise
    );
    sessions.setDirty(key, true);
    select(NEXT);
    if (change === 'clear') select(undefined);
    if (change === 'readonly') select({ ...NEXT, isReadOnly: true });
    if (change === 'original') select(EVENT);
    if (change === 'unpin') sessions.setPinned(key, false);
    if (change === 'close') sessions.completeClose(key);
    if (change === 'dispose') dispose();
    decision.resolve(true);
    await requests[0];
    expect(sessions.state.session?.request.event?.id).not.toBe(NEXT.id);
  }
);

it('keeps pinning when an explicit edit follows a rejected automatic replacement', async () => {
  const confirm = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const { sessions, select, requests, key, open } = await setup(confirm);
  sessions.setDirty(key, true);
  select(NEXT);
  expect(await requests[0]).toBeUndefined();
  const nextKey = await open({ event: NEXT });
  expect(nextKey).not.toBe(key);
  expect(sessions.state.session?.request.event?.id).toBe(NEXT.id);
  expect(sessions.state.pinned).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
});

it('rechecks selection when explicit editing waits for discard consent', async () => {
  const decision = Promise.withResolvers<boolean>();
  const confirm = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockImplementation(() => decision.promise);
  const { sessions, select, requests, key, open } = await setup(confirm);
  sessions.setDirty(key, true);
  select(NEXT);
  expect(await requests[0]).toBeUndefined();
  const editing = open({ event: NEXT });
  const target = { ...NEXT, id: 'event-c', eventId: 'event-c' };
  select(target);
  decision.resolve(true);
  await editing;
  expect(sessions.state.session?.request.event?.id).toBe(target.id);
  expect(sessions.state.pinned).toBe(true);
});
