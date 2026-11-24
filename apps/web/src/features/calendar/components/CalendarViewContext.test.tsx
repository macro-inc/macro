/**
 * @vitest-environment jsdom
 */

import {
  CalendarFocusContextProvider,
  OCCURRENCE_FOCUS_TIMEOUT_MS,
  useCalendarFocus,
} from '@app/features/calendar-view/calendar-focus-target';
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  CalendarViewContextProvider,
  createCalendarEventSelection,
  useCalendarView,
} from './CalendarViewContext';

const teamReset = vi.hoisted(() => ({ fire: () => {} }));
const creates = vi.hoisted(() => ({
  creating: new Set<string>(),
  landed: new Map<string, string>(),
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
  onFocusedEventIdChange?: (eventId: string | undefined) => void
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
  });

  afterEach(() => {
    cleanup();
  });

  it('stays open under the local id without reporting it as a destination', () => {
    const focused = vi.fn();
    const { view } = renderContexts(focused);

    view().selectEvent(local, document.createElement('a'));
    view().refreshSelectedEventFromPage(page(server), true);

    expect(view().selectedEvent()).toBe(local);
    expect(focused).not.toHaveBeenCalled();
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
    expect(focused).toHaveBeenLastCalledWith('server-1');
  });

  it('closes when the landed event is not on the page', () => {
    const { view } = renderContexts();
    view().selectEvent(local, document.createElement('a'));

    creates.creating.delete('local-1');
    creates.landed.set('local-1', 'server-1');
    view().refreshSelectedEventFromPage(page(), true);

    expect(view().selectedEvent()).toBeUndefined();
  });
});
