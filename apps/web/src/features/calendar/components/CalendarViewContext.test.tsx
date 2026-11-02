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

vi.mock('@queries/calendar/team-cache', () => ({
  subscribeToTeamCalendarReset: (onReset: () => void) => {
    teamReset.fire = onReset;
    return () => {};
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

function renderContexts() {
  let focus!: ReturnType<typeof useCalendarFocus>;
  let view!: ReturnType<typeof useCalendarView>;
  function Probe() {
    focus = useCalendarFocus();
    view = useCalendarView();
    return null;
  }
  render(() => (
    <CalendarFocusContextProvider>
      <CalendarViewContextProvider>
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
