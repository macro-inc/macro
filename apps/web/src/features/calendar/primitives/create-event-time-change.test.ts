import { Calendar } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { RECURRING_EVENT } from '../tests/fixtures';
import type { CalendarEvent } from '../types';
import { createEventTimeChange } from './create-event-time-change';

function setup(
  event: CalendarEvent = RECURRING_EVENT,
  save = vi.fn(async (_args: unknown) => {})
) {
  return createRoot((dispose) => {
    const calendar = new Calendar(document.createElement('div'), {
      plugins: [timeGridPlugin],
      initialView: 'timeGridWeek',
    });
    const moved = calendar.addEvent({
      start: '2026-11-09T16:00:00Z',
      end: '2026-11-09T17:00:00Z',
    });
    if (!moved) throw new Error('Missing test event');
    const revert = vi.fn();
    const onError = vi.fn();
    const controller = createEventTimeChange({
      active: () => true,
      save,
      onError,
    });
    return {
      controller,
      save,
      onError,
      revert,
      change: { event: moved, revert },
      event,
      dispose,
    };
  });
}

describe('grid time changes', () => {
  it('waits for scope and cancels without writing', async () => {
    const s = setup();
    try {
      await s.controller.handle(s.change, s.event);
      expect(s.controller.choosing()).toBe(true);
      expect(s.controller.scope()).toBe('this_event');
      expect(s.save).not.toHaveBeenCalled();
      expect(s.revert).not.toHaveBeenCalled();
      s.controller.cancel();
      expect(s.revert).toHaveBeenCalledOnce();
      expect(s.controller.pending()).toBe(false);
      await s.controller.confirm();
      expect(s.save).not.toHaveBeenCalled();
    } finally {
      s.dispose();
    }
  });

  it.each(['this_event', 'all'] as const)(
    'saves %s through the shared mutation target',
    async (scope) => {
      const s = setup();
      try {
        await s.controller.handle(s.change, s.event);
        s.controller.setScope(scope);
        await s.controller.confirm();
        expect(s.save).toHaveBeenCalledOnce();
        expect(s.save).toHaveBeenCalledWith(
          expect.objectContaining({
            eventId: 'series',
            calendarId: 'calendar',
            scope,
            parentSpan: expect.anything(),
            recurrenceId:
              scope === 'this_event' ? s.event.occurrenceKey : undefined,
          })
        );
        expect(s.revert).not.toHaveBeenCalled();
        expect(s.controller.pending()).toBe(false);
      } finally {
        s.dispose();
      }
    }
  );

  it('rolls back a failed save and reports the existing error path', async () => {
    const error = new Error('Save refused');
    const s = setup(
      RECURRING_EVENT,
      vi.fn(async () => {
        throw error;
      })
    );
    try {
      await s.controller.handle(s.change, s.event);
      await s.controller.confirm();
      expect(s.revert).toHaveBeenCalledOnce();
      expect(s.onError).toHaveBeenCalledWith(error);
      expect(s.controller.pending()).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it('reverts restricted and invalid changes without asking', async () => {
    const s = setup({ ...RECURRING_EVENT, isReadOnly: true });
    try {
      await s.controller.handle(s.change, s.event);
      expect(s.revert).toHaveBeenCalledOnce();
      expect(s.save).not.toHaveBeenCalled();
      expect(s.controller.choosing()).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it('saves one-off events immediately', async () => {
    const s = setup({ ...RECURRING_EVENT, recurrenceLines: [] });
    try {
      await s.controller.handle(s.change, s.event);
      expect(s.save).toHaveBeenCalledOnce();
      expect(s.controller.choosing()).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it('blocks duplicate submissions and further grid changes until saving finishes', async () => {
    const completion = Promise.withResolvers<void>();
    const s = setup(
      RECURRING_EVENT,
      vi.fn(async () => {
        await completion.promise;
      })
    );
    try {
      await s.controller.handle(s.change, s.event);
      const saving = s.controller.confirm();
      await s.controller.confirm();
      const secondRevert = vi.fn();
      await s.controller.handle({ ...s.change, revert: secondRevert }, s.event);
      expect(secondRevert).toHaveBeenCalledOnce();
      expect(s.save).toHaveBeenCalledOnce();
      expect(s.controller.pending()).toBe(true);
      completion.resolve();
      await saving;
      expect(s.controller.pending()).toBe(false);
    } finally {
      completion.resolve();
      s.dispose();
    }
  });

  it('reverts an unanswered dialog when its page is disposed', async () => {
    const s = setup();
    await s.controller.handle(s.change, s.event);
    s.dispose();
    expect(s.revert).toHaveBeenCalledOnce();
    expect(s.save).not.toHaveBeenCalled();
  });
});
