import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import { createCalendarFocusTarget } from './calendar-target';
import type { CalendarFocusRequest } from './types';

vi.mock('@queries/calendar/occurrences', () => ({
  syncCalendarOccurrences: vi.fn(),
}));

const OCCURRENCE_KEY = '2026-10-29T21:00:00+00:00';

function request(requestId: number): CalendarFocusRequest {
  return {
    eventId: 'just-added-copy',
    occurrenceKey: OCCURRENCE_KEY,
    range: { startDate: '2026-10-29', endDate: '2026-10-30' },
    requestId,
    requestedAt: Date.now(),
  } as CalendarFocusRequest;
}

function occurrence(eventId: string): CalendarOccurrenceItem {
  return {
    event: { id: eventId },
    occurrence: {
      occurrenceKey: OCCURRENCE_KEY,
      time: {
        kind: 'timed',
        startsAt: '2026-10-29T21:00:00Z',
        endsAt: '2026-10-29T21:30:00Z',
      },
    },
  } as unknown as CalendarOccurrenceItem;
}

function setup(items: CalendarOccurrenceItem[], isSuccess = true) {
  const refreshCalendar = vi.fn(async () => {});
  const [aim, setAim] = createSignal<CalendarFocusRequest | undefined>(
    request(1)
  );
  const [locator, setLocator] = createStore({ isSuccess, data: { items } });
  return createRoot((dispose) => ({
    target: createCalendarFocusTarget(aim, locator, refreshCalendar),
    refreshCalendar,
    setAim,
    setLocator,
    dispose,
  }));
}

describe('createCalendarFocusTarget', () => {
  it('syncs once when the loaded week lacks the event, then lands on it', async () => {
    // A cached week from before the copy was added.
    const view = setup([occurrence('older-event')]);
    await Promise.resolve();

    expect(view.target()).toBeUndefined();
    expect(view.refreshCalendar).toHaveBeenCalledOnce();

    view.setLocator('data', 'items', [
      occurrence('older-event'),
      occurrence('just-added-copy'),
    ]);
    expect(view.target()?.eventId).toBe('just-added-copy');
    expect(view.target()?.requestId).toBe(1);
    expect(view.refreshCalendar).toHaveBeenCalledOnce();
    view.dispose();
  });

  it('does not sync for an event the week already has', async () => {
    const view = setup([occurrence('just-added-copy')]);
    await Promise.resolve();

    expect(view.target()?.eventId).toBe('just-added-copy');
    expect(view.refreshCalendar).not.toHaveBeenCalled();
    view.dispose();
  });

  it('syncs again for a later open that still finds nothing', async () => {
    const view = setup([]);
    await Promise.resolve();
    view.setAim(request(2));
    await Promise.resolve();

    expect(view.refreshCalendar).toHaveBeenCalledTimes(2);
    view.dispose();
  });

  it('waits for the locator before deciding the event is missing', async () => {
    const view = setup([], false);
    await Promise.resolve();
    expect(view.refreshCalendar).not.toHaveBeenCalled();

    view.setLocator('isSuccess', true);
    await Promise.resolve();

    expect(view.refreshCalendar).toHaveBeenCalledOnce();
    view.dispose();
  });
});
