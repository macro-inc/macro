import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarFocusTarget } from '../calendar-focus-target';
import { createAgendaOccurrenceFocus } from './create-agenda-occurrence-focus';

afterEach(() => document.body.replaceChildren());

describe('agenda occurrence focus', () => {
  it('rejects a superseded request even when its scheduled frame runs', () => {
    const row = document.createElement('div');
    document.body.append(row);
    const scheduled: (() => void)[] = [];
    const focus = vi.fn();
    const [target, setTarget] = createSignal<CalendarFocusTarget>({
      eventId: 'event',
      occurrenceKey: 'first',
      requestId: 1,
      requestedAt: 0,
      date: new Date(2026, 10, 13),
    });
    const dispose = createRoot((dispose) => {
      createAgendaOccurrenceFocus({
        event: () => ({ eventId: 'event', occurrenceKey: 'first' }),
        target,
        element: () => row,
        focus,
        schedule: (callback) => {
          scheduled.push(callback);
          return () => {};
        },
      });
      return dispose;
    });
    expect(scheduled).toHaveLength(1);
    setTarget({
      eventId: 'event',
      occurrenceKey: 'second',
      requestId: 2,
      requestedAt: 1,
      date: new Date(2026, 10, 14),
    });
    scheduled[0]?.();
    expect(focus).not.toHaveBeenCalled();
    dispose();
  });

  it('focuses an attached matching row and rejects a detached row', () => {
    const row = document.createElement('div');
    document.body.append(row);
    const scheduled: (() => void)[] = [];
    const focus = vi.fn();
    const event = { eventId: 'event', occurrenceKey: 'first' };
    const dispose = createRoot((dispose) => {
      createAgendaOccurrenceFocus({
        event: () => event,
        target: () => ({
          eventId: 'event',
          occurrenceKey: 'first',
          requestId: 1,
          requestedAt: 0,
          date: new Date(2026, 10, 13),
        }),
        element: () => row,
        focus,
        schedule: (callback) => {
          scheduled.push(callback);
          return () => {};
        },
      });
      return dispose;
    });
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(focus).toHaveBeenCalledExactlyOnceWith(event, row, 1);
    row.remove();
    scheduled[0]?.();
    expect(focus).toHaveBeenCalledTimes(1);
    dispose();
  });
});
