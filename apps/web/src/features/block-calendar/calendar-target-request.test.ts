import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  type CalendarTargetAim,
  createCalendarTargetAim,
} from './calendar-target-request';
import type { CalendarBlockProps, CalendarBlockTargetRequest } from './types';

const RANGE = {
  start: '2026-08-17T04:00:00.000Z',
  end: '2026-08-18T04:00:00.000Z',
  startDate: '2026-08-17',
  endDate: '2026-08-18',
};

const NEXT_WEEK_RANGE = {
  start: '2026-08-24T04:00:00.000Z',
  end: '2026-08-25T04:00:00.000Z',
  startDate: '2026-08-24',
  endDate: '2026-08-25',
};

const standup: CalendarBlockProps = {
  eventId: 'event-1',
  occurrenceKey: '2026-08-17T14:00:00+00:00',
  range: RANGE,
};

function withAim<T>(
  options: Parameters<typeof createCalendarTargetAim>[0],
  run: (aim: CalendarTargetAim) => T
): T {
  return createRoot((dispose) => {
    const result = run(createCalendarTargetAim(options));
    dispose();
    return result;
  });
}

describe('createCalendarTargetAim', () => {
  it('aims at params that already carry a locator range', () => {
    const target = withAim({ initial: standup }, (aim) => aim.target());

    expect(target?.eventId).toBe('event-1');
    expect(target?.occurrenceKey).toBe('2026-08-17T14:00:00+00:00');
    expect(target?.range).toEqual(RANGE);
  });

  // The calendar is a singleton block, so a second click on the same mention
  // is the only way back to an event the user has since paged away from.
  it('mints a fresh request for a repeat aim at the occurrence already targeted', () => {
    const [first, second] = withAim({ initial: standup }, (aim) => {
      const before = aim.target();
      aim.aimAt(standup);
      return [before, aim.target()];
    });

    expect(second?.eventId).toBe(first?.eventId);
    expect(second?.occurrenceKey).toBe(first?.occurrenceKey);
    expect(second?.requestId).toBeGreaterThan(first?.requestId ?? 0);
  });

  it('clears the target when aimed at params without an event', () => {
    const target = withAim({ initial: standup }, (aim) => {
      aim.aimAt({});
      return aim.target();
    });

    expect(target).toBeUndefined();
  });

  it('resolves params without a range through the preview', async () => {
    const resolveFromPreview = vi.fn(
      async (
        _params: CalendarBlockProps,
        requestId: number
      ): Promise<CalendarBlockTargetRequest> => ({
        eventId: 'viewer-copy',
        range: RANGE,
        occurrenceKey: '2026-08-17T14:00:00+00:00',
        requestId,
        requestedAt: Date.now(),
      })
    );

    const aim = createRoot(() =>
      createCalendarTargetAim({
        initial: { eventId: 'someone-elses-copy' },
        resolveFromPreview,
      })
    );
    await vi.waitFor(() => expect(aim.target()).toBeDefined());

    expect(resolveFromPreview).toHaveBeenCalledTimes(1);
    expect(aim.target()?.eventId).toBe('viewer-copy');
  });

  // A mention whose event was deleted resolves to nothing. Holding the
  // previous target would leave the focus effect free to land on an
  // unrelated event the user never asked for.
  it('clears the target when the latest preview cannot resolve', async () => {
    const resolveFromPreview = vi.fn(async () => undefined);

    const aim = createRoot(() =>
      createCalendarTargetAim({ initial: standup, resolveFromPreview })
    );
    expect(aim.target()?.eventId).toBe('event-1');

    aim.aimAt({ eventId: 'deleted-event' });
    await vi.waitFor(() => expect(aim.target()).toBeUndefined());

    expect(resolveFromPreview).toHaveBeenCalledTimes(1);
  });

  it('drops a preview answer that a newer aim has superseded', async () => {
    let releaseStalePreview: (() => void) | undefined;
    const resolveFromPreview = vi.fn(
      async (
        _params: CalendarBlockProps,
        requestId: number
      ): Promise<CalendarBlockTargetRequest> => {
        await new Promise<void>((resolve) => {
          releaseStalePreview = resolve;
        });
        return {
          eventId: 'stale-event',
          range: RANGE,
          requestId,
          requestedAt: Date.now(),
        };
      }
    );

    const aim = createRoot(() =>
      createCalendarTargetAim({ initial: {}, resolveFromPreview })
    );
    aim.aimAt({ eventId: 'slow-event' });
    await vi.waitFor(() => expect(releaseStalePreview).toBeDefined());

    aim.aimAt({ eventId: 'newer-event', range: NEXT_WEEK_RANGE });
    releaseStalePreview?.();
    await vi.waitFor(() => expect(resolveFromPreview).toHaveBeenCalledTimes(1));

    expect(aim.target()?.eventId).toBe('newer-event');
  });
});
