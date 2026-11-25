/**
 * @vitest-environment jsdom
 */

import {
  CalendarFocusContextProvider,
  OCCURRENCE_FOCUS_TIMEOUT_MS,
  useCalendarFocus,
} from '@app/features/calendar-view/calendar-focus-target';
import type { CalendarOccurrenceMove } from '@queries/calendar/graphql/mutations';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  CalendarViewContextProvider,
  createCalendarEventSelection,
  selectionOnPage,
  useCalendarView,
} from './CalendarViewContext';

const teamReset = vi.hoisted(() => ({ fire: () => {} }));
const creates = vi.hoisted(() => ({
  creating: new Set<string>(),
  landed: new Map<string, string>(),
  answered: new Map<string, CalendarOccurrenceItem>(),
}));
/** Moving occurrences by `JSON.stringify([eventId, occurrenceKey])`, as the grid keys chips. */
const moves = vi.hoisted(() => ({
  moving: new Set<string>(),
  listeners: new Set<(move?: CalendarOccurrenceMove) => void>(),
}));

vi.mock('@queries/calendar/team-cache', () => ({
  subscribeToTeamCalendarReset: (onReset: () => void) => {
    teamReset.fire = onReset;
    return () => {};
  },
}));
vi.mock('@queries/calendar/graphql/mutations', () => ({
  isCalendarEventCreating: (id: string) => creates.creating.has(id),
  createdCalendarEventId: (id: string) => creates.landed.get(id),
  createdCalendarOccurrence: (id: string) => creates.answered.get(id),
  isCalendarOccurrenceMoving: (eventId: string, occurrenceKey: string) =>
    moves.moving.has(JSON.stringify([eventId, occurrenceKey])),
  onCalendarOccurrenceMoved: (
    listener: (move?: CalendarOccurrenceMove) => void
  ) => {
    moves.listeners.add(listener);
    return () => moves.listeners.delete(listener);
  },
}));
vi.mock('../hooks/use-calendar-sources', () => ({
  useCalendarSources: () => ({
    sources: () => [],
    sourceById: () => new Map(),
    sourcesReady: () => true,
  }),
}));
vi.mock('../utils/preferences', () => ({
  useCalendarPreferences: () => [{ hiddenSourceIds: [] }, vi.fn()],
}));

const EVENT = { id: 'ooo', eventId: 'ooo-1' } as CalendarEvent;
const OCCURRENCE = {
  eventId: 'ooo-2',
  occurrenceKey: '2026-11-19',
  date: new Date(2026, 10, 19),
};

function withSelection(
  run: (selection: ReturnType<typeof createCalendarEventSelection>) => void
) {
  createRoot((dispose) => {
    run(createCalendarEventSelection());
    dispose();
  });
}

function renderContexts(
  onFocusedEventIdChange?: (eventId: string | undefined) => void,
  focusedEventId?: () => string | undefined
) {
  let focus!: ReturnType<typeof useCalendarFocus>;
  let view!: ReturnType<typeof useCalendarView>;
  function Probe() {
    focus = useCalendarFocus();
    view = useCalendarView();
    return null;
  }
  render(() => (
    <CalendarFocusContextProvider>
      <CalendarViewContextProvider
        focusedEventId={focusedEventId?.()}
        onFocusedEventIdChange={onFocusedEventIdChange}
      >
        <Probe />
      </CalendarViewContextProvider>
    </CalendarFocusContextProvider>
  ));
  return { focus: () => focus, view: () => view };
}

describe('createCalendarEventSelection', () => {
  it('keeps a list selection on its row when the chip mounts', () => {
    withSelection((selection) => {
      const row = document.createElement('button');
      const chip = document.createElement('a');

      selection.select(EVENT, row, 'agenda');
      selection.reanchor(EVENT, chip);

      expect(selection.anchor()).toBe(row);
      expect(selection.origin()).toBe('agenda');
    });
  });

  it('never leaves an anchor without an event when a chip mounts with nothing selected', () => {
    withSelection((selection) => {
      const chip = document.createElement('a');

      selection.reanchor(EVENT, chip);

      expect(selection.event()).toBe(EVENT);
      expect(selection.anchor()).toBe(chip);
    });
  });

  it('moves a grid selection to the chip that replaced its own', () => {
    withSelection((selection) => {
      const chip = document.createElement('a');
      const remounted = document.createElement('a');

      selection.select(EVENT, chip);
      selection.reanchor(EVENT, remounted);

      expect(selection.anchor()).toBe(remounted);
    });
  });
});

describe('CalendarViewContext with a row waiting for its chip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('lets a newer selection cancel the waiting row', () => {
    const { focus, view } = renderContexts();
    const onTimeout = vi.fn();
    const chip = document.createElement('a');

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    view().selectEvent(EVENT, chip);

    expect(focus().pendingTarget()).toBeUndefined();
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(view().selectedEventAnchor()).toBe(chip);
  });

  it('drops the waiting row when team data resets', () => {
    const { focus } = renderContexts();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    teamReset.fire();

    expect(focus().pendingTarget()).toBeUndefined();
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('keeps the row waiting when an open card only changes anchor', () => {
    const { focus, view } = renderContexts();
    const chip = document.createElement('a');
    view().selectEvent(EVENT, chip);

    focus().focusOccurrence(OCCURRENCE, vi.fn());
    view().reanchorSelectedEvent(EVENT, document.createElement('a'));

    expect(focus().pendingTarget()).toMatchObject(OCCURRENCE);
  });
});

describe('details opened on an event whose create has not landed', () => {
  const KEY = '2026-11-28T15:00:00+00:00';
  const occurrence = (eventId: string, title = 'Offsite') =>
    ({
      id: JSON.stringify([eventId, KEY]),
      eventId,
      occurrenceKey: KEY,
      title,
      sourceCalendarIds: ['calendar-1'],
      calendar: { id: 'calendar-1' },
    }) as CalendarEvent;
  const local = occurrence('local-1');
  const server = occurrence('server-1', 'Offsite (synced)');
  const page = (...events: CalendarEvent[]) =>
    new Map(events.map((event) => [event.id, event]));

  beforeEach(() => {
    creates.creating = new Set(['local-1']);
    creates.landed = new Map();
    creates.answered = new Map();
  });

  afterEach(() => {
    cleanup();
  });

  it('stays open under the local id without naming it as a destination', () => {
    // The details of another event were open, so the URL named it.
    const [focused, setFocused] = createSignal<string | undefined>('other-1');
    const { view } = renderContexts(setFocused, focused);
    view().selectEvent(occurrence('other-1'), document.createElement('a'));

    view().selectEvent(local, document.createElement('a'));
    view().refreshSelectedEventFromPage(page(server), true);

    expect(view().selectedEvent()).toBe(local);
    expect(focused()).toBeUndefined();
  });

  it('moves to the server id and its chip once the create lands', () => {
    const focused = vi.fn();
    const { view } = renderContexts(focused);
    const chip = document.createElement('a');
    view().selectEvent(local, document.createElement('a'));

    creates.creating.delete('local-1');
    creates.landed.set('local-1', 'server-1');
    view().refreshSelectedEventFromPage(page(server), true, (id) =>
      id === server.id ? chip : undefined
    );

    expect(view().selectedEvent()).toBe(server);
    expect(view().selectedEventAnchor()).toBe(chip);
    expect(focused).toHaveBeenLastCalledWith('server-1', KEY);
  });

  it('keeps a list selection on its row when the create lands', () => {
    const { view } = renderContexts();
    const row = document.createElement('button');
    view().selectEvent(local, row, 'agenda');

    creates.creating.delete('local-1');
    creates.landed.set('local-1', 'server-1');
    view().refreshSelectedEventFromPage(page(server), true, () =>
      document.createElement('a')
    );

    expect(view().selectedEvent()).toBe(server);
    expect(view().selectedEventAnchor()).toBe(row);
  });

  it('closes when the landed event is not on the page', () => {
    const { view } = renderContexts();
    view().selectEvent(local, document.createElement('a'));

    creates.creating.delete('local-1');
    creates.landed.set('local-1', 'server-1');
    view().refreshSelectedEventFromPage(page(), true);

    expect(view().selectedEvent()).toBeUndefined();
  });

  describe('when the create’s answer carries the server’s copy', () => {
    // The server's copy as the create's answer carries it: the organizer,
    // the viewer's own guest row and a join link the local copy lacks.
    const answer = {
      event: {
        id: 'server-1',
        calendarId: 'calendar-1',
        title: 'Offsite',
        time: {
          kind: 'timed',
          startsAt: KEY,
          endsAt: '2026-11-28T16:00:00+00:00',
          timeZone: 'America/New_York',
        },
        status: 'confirmed',
        isReadOnly: false,
        isSnapshot: false,
        recurrenceLines: [],
        organizerEmail: 'me@example.com',
        conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        conferenceProvider: 'google_meet',
        attendees: [
          {
            email: 'me@example.com',
            isOrganizer: true,
            isSelf: true,
            isOptional: false,
            responseStatus: 'accepted',
          },
        ],
        viewerCan: {
          editDetails: true,
          inviteGuests: true,
          removeGuests: true,
          setGuestPolicy: true,
          rsvp: true,
          organize: true,
        },
      },
      occurrence: {
        eventId: 'server-1',
        occurrenceKey: KEY,
        recurrenceId: null,
        time: {
          kind: 'timed',
          startsAt: KEY,
          endsAt: '2026-11-28T16:00:00+00:00',
          timeZone: null,
        },
        isCancelled: false,
      },
    } as unknown as CalendarOccurrenceItem;
    const land = () => {
      creates.creating.delete('local-1');
      creates.landed.set('local-1', 'server-1');
      creates.answered.set('local-1', answer);
    };

    it('lands on it rather than the only other occurrence of the series the page draws', () => {
      const { view } = renderContexts();
      view().selectEvent(local, document.createElement('a'));
      land();
      const nextDay = {
        ...server,
        id: JSON.stringify(['server-1', '2026-11-29T15:00:00+00:00']),
        occurrenceKey: '2026-11-29T15:00:00+00:00',
      };

      view().refreshSelectedEventFromPage(page(nextDay), true);

      expect(view().selectedEvent()).toMatchObject({
        id: server.id,
        occurrenceKey: KEY,
      });
    });

    it('moves the details and the destination to it while the page still draws the local copy', () => {
      const focused = vi.fn();
      const { view } = renderContexts(focused);
      const chip = document.createElement('a');
      view().selectEvent(local, chip);

      land();
      view().refreshSelectedEventFromPage(page(local), true, () => undefined);

      expect(view().selectedEvent()).toMatchObject({
        id: server.id,
        eventId: 'server-1',
        conferenceUrl: 'https://meet.google.com/abc-defg-hij',
        organizerEmail: 'me@example.com',
        attendees: [expect.objectContaining({ isSelf: true })],
        viewerCan: expect.objectContaining({ rsvp: true }),
      });
      expect(view().selectedEvent()?.timeZone).toBeUndefined();
      expect(view().selectedEventAnchor()).toBe(chip);
      expect(focused).toHaveBeenLastCalledWith('server-1', KEY);
    });

    it('stays open until the page draws the server’s copy, then follows it', () => {
      const { view } = renderContexts();
      view().selectEvent(local, document.createElement('a'));
      land();
      view().refreshSelectedEventFromPage(page(local), true);

      view().refreshSelectedEventFromPage(page(local), true);
      expect(view().selectedEvent()?.eventId).toBe('server-1');

      view().refreshSelectedEventFromPage(page(server), true);
      expect(view().selectedEvent()).toBe(server);
    });

    it('closes when the page drops the local copy without drawing the server’s', () => {
      const { view } = renderContexts();
      view().selectEvent(local, document.createElement('a'));
      land();
      view().refreshSelectedEventFromPage(page(local), true);

      view().refreshSelectedEventFromPage(page(), true);

      expect(view().selectedEvent()).toBeUndefined();
    });

    it('keeps the local chip as the selected one without moving the details back to it', () => {
      const { view } = renderContexts();
      view().selectEvent(local, document.createElement('a'));
      land();
      view().refreshSelectedEventFromPage(page(local), true);
      const selected = view().selectedEvent();
      if (!selected) throw new Error('the details closed');

      expect(selectionOnPage(selected, page(local))).toBe(local);
      const remounted = document.createElement('a');
      view().reanchorSelectedEvent(local, remounted);

      expect(view().selectedEvent()?.eventId).toBe('server-1');
      expect(view().selectedEventAnchor()).toBe(remounted);
    });

    it('names the server id when the local chip is opened again', () => {
      const [focused, setFocused] = createSignal<string | undefined>();
      const { view } = renderContexts(setFocused, focused);
      view().selectEvent(local, document.createElement('a'));
      land();
      view().refreshSelectedEventFromPage(page(local), true);

      view().closeEventDetails();
      view().selectEvent(local, document.createElement('a'));

      expect(focused()).toBe('server-1');
      expect(view().selectedEvent()).toBe(local);
    });
  });
});

describe('details opened on an event that was just moved', () => {
  const FROM = '2026-11-28T15:00:00+00:00';
  const TO = '2026-11-28T16:00:00+00:00';
  // The grid keys a chip by its event and occurrence key; a standalone
  // event's key is its start, so a move gives its chip a new id.
  const occurrence = (occurrenceKey: string, start = occurrenceKey) =>
    ({
      id: JSON.stringify(['event-1', occurrenceKey]),
      eventId: 'event-1',
      occurrenceKey,
      start,
      title: 'Planning',
      sourceCalendarIds: ['calendar-1'],
      calendar: { id: 'calendar-1' },
    }) as CalendarEvent;
  const moved = occurrence(FROM, TO);
  const saved = occurrence(TO);
  const page = (...events: CalendarEvent[]) =>
    new Map(events.map((event) => [event.id, event]));
  const ref = JSON.stringify(['event-1', FROM]);
  const announce = (move?: CalendarOccurrenceMove) => {
    for (const listener of moves.listeners) listener(move);
  };
  /** The move's answer names the saved occurrence, and the move ends. */
  const answer = () => {
    announce({
      from: { eventId: 'event-1', occurrenceKey: FROM },
      to: { eventId: 'event-1', occurrenceKey: TO },
    });
    moves.moving.delete(ref);
    announce();
  };

  beforeEach(() => {
    creates.creating = new Set();
    creates.landed = new Map();
    creates.answered = new Map();
    moves.moving = new Set([ref]);
  });

  afterEach(() => {
    cleanup();
  });

  it('stay open while the move waits for its answer, though the page no longer draws its occurrence', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));

    view().refreshSelectedEventFromPage(page(saved), true);

    expect(view().selectedEvent()).toBe(moved);
  });

  it('follow it to the saved occurrence and its chip, and keep naming the event', () => {
    const focused = vi.fn();
    const { view } = renderContexts(focused);
    const chip = document.createElement('a');
    view().selectEvent(moved, document.createElement('a'));

    answer();
    view().refreshSelectedEventFromPage(page(saved), true, (id) =>
      id === saved.id ? chip : undefined
    );

    expect(view().selectedEvent()).toBe(saved);
    expect(view().selectedEventAnchor()).toBe(chip);
    expect(focused).toHaveBeenLastCalledWith('event-1', TO);
  });

  it('follow it while the page still draws the occurrence it moved from', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));

    answer();
    view().refreshSelectedEventFromPage(
      page(occurrence(FROM), saved),
      true,
      () => undefined
    );

    expect(view().selectedEvent()).toBe(saved);
  });

  it('stay on the occurrence the page draws until it draws the saved one', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));
    answer();

    view().refreshSelectedEventFromPage(page(moved), true);
    expect(view().selectedEvent()).toBe(moved);

    view().refreshSelectedEventFromPage(page(saved), true);
    expect(view().selectedEvent()).toBe(saved);
  });

  it('keep a list selection on its row', () => {
    const { view } = renderContexts();
    const row = document.createElement('button');
    view().selectEvent(moved, row, 'agenda');

    answer();
    view().refreshSelectedEventFromPage(page(saved), true, () =>
      document.createElement('a')
    );

    expect(view().selectedEvent()).toBe(saved);
    expect(view().selectedEventAnchor()).toBe(row);
  });

  it('close as before when the answer did not say which occurrence replaced it', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));

    moves.moving.delete(ref);
    announce();
    view().refreshSelectedEventFromPage(page(saved), true);

    expect(view().selectedEvent()).toBeUndefined();
  });

  it('keep following through the chip remounting before the page draws the saved occurrence', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));
    answer();

    view().reanchorSelectedEvent(moved, document.createElement('a'));
    view().refreshSelectedEventFromPage(page(saved), true);

    expect(view().selectedEvent()).toBe(saved);
  });

  it('never lead a later selection to where an earlier move went', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));
    answer();
    view().refreshSelectedEventFromPage(page(saved), true);
    view().closeEventDetails();

    // The event now repeats, and an instance takes the key the move left.
    const instance = { ...occurrence(FROM), recurrenceId: FROM };
    view().selectEvent(instance, document.createElement('a'));
    view().refreshSelectedEventFromPage(page(instance, saved), true);

    expect(view().selectedEvent()).toBe(instance);
  });

  it('follow only the move of the occurrence they show', () => {
    const { view } = renderContexts();
    const other = occurrence('2026-11-29T15:00:00+00:00');
    view().selectEvent(other, document.createElement('a'));

    answer();
    view().refreshSelectedEventFromPage(page(other, saved), true);

    expect(view().selectedEvent()).toBe(other);
  });

  it('close when the page draws neither occurrence', () => {
    const { view } = renderContexts();
    view().selectEvent(moved, document.createElement('a'));

    answer();
    view().refreshSelectedEventFromPage(page(), true);

    expect(view().selectedEvent()).toBeUndefined();
  });

  it('stay on a series occurrence moved alone, which keeps its key', () => {
    const SERIES_KEY = '2026-11-27T15:00:00+00:00';
    const instance = {
      ...occurrence(SERIES_KEY),
      recurrenceId: SERIES_KEY,
      recurrenceLines: ['RRULE:FREQ=DAILY'],
    };
    const movedInstance = { ...instance, start: '2026-11-27T17:00:00+00:00' };
    const { view } = renderContexts();
    view().selectEvent(instance, document.createElement('a'));
    moves.moving.add(JSON.stringify(['event-1', SERIES_KEY]));

    view().refreshSelectedEventFromPage(page(movedInstance), true);
    moves.moving.clear();
    view().refreshSelectedEventFromPage(page(movedInstance), true);

    expect(view().selectedEvent()).toBe(movedInstance);
  });
});
