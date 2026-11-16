import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '../../calendar/types';
import { createNeedsReplyRows } from './create-needs-reply-rows';

const first: CalendarEvent = {
  id: 'first',
  eventId: 'first',
  occurrenceKey: '2026-11-16',
  isCancelled: false,
  isReadOnly: false,
  attendees: [],
  guestPolicy: DEFAULT_GUEST_POLICY,
  viewerCan: NO_VIEWER_CAPABILITIES,
  sourceCalendarIds: [],
  recurrenceLines: [],
  title: 'First',
  start: '2026-11-16T09:00:00Z',
  end: '2026-11-16T10:00:00Z',
  allDay: false,
  calendar: DEFAULT_CALENDAR_SOURCE,
  visibleCalendars: [],
};
const second: CalendarEvent = {
  ...first,
  id: 'second',
  eventId: 'second',
  title: 'Second',
};

describe('pending Needs reply rows', () => {
  it('keeps order and current data until a successful response settles', () => {
    createRoot((dispose) => {
      const [pending, setPending] = createSignal(false);
      const [events, setEvents] = createSignal([first, second]);
      const [lookup, setLookup] = createSignal(
        new Map([
          [first.id, first],
          [second.id, second],
        ])
      );
      const rows = createNeedsReplyRows({
        account: () => 'viewer',
        events,
        pending,
        findEvent: (id) => lookup().get(id),
      });
      expect(rows()).toEqual([first, second]);
      setPending(true);
      const updated = { ...first, title: 'Updated' };
      batch(() => {
        setLookup(
          new Map([
            [updated.id, updated],
            [second.id, second],
          ])
        );
        setEvents([second]);
      });
      expect(rows()).toEqual([updated, second]);
      setPending(false);
      expect(rows()).toEqual([second]);
      dispose();
    });
  });

  it('never retains a row after its source or account becomes unavailable', () => {
    createRoot((dispose) => {
      const [account, setAccount] = createSignal<string | undefined>('viewer');
      const [events, setEvents] = createSignal([first]);
      const [lookup, setLookup] = createSignal<CalendarEvent | undefined>(
        first
      );
      const rows = createNeedsReplyRows({
        account,
        events,
        pending: () => true,
        findEvent: () => lookup(),
      });
      expect(rows()).toEqual([first]);
      batch(() => {
        setEvents([]);
        setLookup(undefined);
      });
      expect(rows()).toEqual([]);
      batch(() => {
        setEvents([first]);
        setLookup(first);
      });
      expect(rows()).toEqual([first]);
      batch(() => {
        setAccount('another-viewer');
        setEvents([]);
      });
      expect(rows()).toEqual([]);
      setEvents([first]);
      setAccount(undefined);
      expect(rows()).toEqual([]);
      dispose();
    });
  });

  it('restores the same row when a failed response rolls back', () => {
    createRoot((dispose) => {
      const [pending, setPending] = createSignal(false);
      const [events, setEvents] = createSignal([first]);
      const rows = createNeedsReplyRows({
        account: () => 'viewer',
        events,
        pending,
        findEvent: () => first,
      });
      expect(rows()).toEqual([first]);
      batch(() => {
        setPending(true);
        setEvents([]);
      });
      expect(rows()).toEqual([first]);
      batch(() => {
        setPending(false);
        setEvents([first]);
      });
      expect(rows()).toEqual([first]);
      dispose();
    });
  });
});
