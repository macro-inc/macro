/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarFocusContextProvider,
  type CalendarFocusTarget,
  OCCURRENCE_FOCUS_TIMEOUT_MS,
  useCalendarFocus,
} from './calendar-focus-target';

const OCCURRENCE = {
  eventId: 'ooo-1',
  occurrenceKey: '2026-11-19',
  date: new Date(2026, 10, 19),
};

function renderFocus() {
  const [navigation, setNavigation] = createSignal<CalendarFocusTarget>();
  let focus!: ReturnType<typeof useCalendarFocus>;
  function Probe() {
    focus = useCalendarFocus();
    return null;
  }
  const view = render(() => (
    <CalendarFocusContextProvider target={navigation}>
      <Probe />
    </CalendarFocusContextProvider>
  ));
  return { focus: () => focus, setNavigation, unmount: view.unmount };
}

function navigationTarget(requestId: number): CalendarFocusTarget {
  return {
    eventId: 'meeting',
    occurrenceKey: '2026-11-20T15:00:00Z',
    date: new Date(2026, 10, 20),
    requestId,
    requestedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalendarFocusContext occurrence requests', () => {
  it('stays pending until the page consumes it, without falling back', () => {
    const { focus } = renderFocus();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    const target = focus().pendingTarget();

    expect(target).toMatchObject(OCCURRENCE);
    focus().consume(target?.requestId ?? 0);
    expect(focus().pendingTarget()).toBeUndefined();

    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('falls back once when no page renders the occurrence in time', () => {
    const { focus } = renderFocus();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(focus().pendingTarget()).toBeUndefined();

    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('replaces an earlier occurrence request and its fallback', () => {
    const { focus } = renderFocus();
    const first = vi.fn();
    const second = vi.fn();

    focus().focusOccurrence(OCCURRENCE, first);
    focus().focusOccurrence(
      { ...OCCURRENCE, occurrenceKey: '2026-11-20' },
      second
    );
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('yields to a newer navigation request without falling back', () => {
    const { focus, setNavigation } = renderFocus();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    vi.advanceTimersByTime(10);
    const navigation = navigationTarget(7);
    setNavigation(navigation);

    expect(focus().pendingTarget()).toBe(navigation);
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('supersedes a navigation request that has not landed', () => {
    const { focus, setNavigation } = renderFocus();
    setNavigation(navigationTarget(3));
    vi.advanceTimersByTime(10);

    focus().focusOccurrence(OCCURRENCE, vi.fn());
    const target = focus().pendingTarget();
    expect(target).toMatchObject(OCCURRENCE);

    focus().consume(target?.requestId ?? 0);
    expect(focus().pendingTarget()).toBeUndefined();
  });

  it('drops a cancelled request without falling back', () => {
    const { focus } = renderFocus();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    focus().cancelOccurrence();

    expect(focus().pendingTarget()).toBeUndefined();
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('never falls back after the calendar unmounts', () => {
    const { focus, unmount } = renderFocus();
    const onTimeout = vi.fn();

    focus().focusOccurrence(OCCURRENCE, onTimeout);
    unmount();
    vi.advanceTimersByTime(OCCURRENCE_FOCUS_TIMEOUT_MS);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
