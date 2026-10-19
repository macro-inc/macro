import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EventReplacementSource } from '../context/event-replacement-source';
import type { EventReplacementPreview } from '../core/event-replacement';
import { createEventReplacement } from './create-event-replacement';

const preview: EventReplacementPreview = {
  operationId: 'reviewed-operation',
  status: 'needs_confirmation',
  title: 'Review',
  startsAt: '2026-11-01T10:00:00Z',
  endsAt: '2026-11-01T11:00:00Z',
  allDay: false,
  attendeeCount: 2,
  isSeries: true,
  removeConference: true,
  completedSteps: 0,
  totalSteps: 2,
};
function source(): EventReplacementSource {
  return {
    prepare: vi.fn(async () => preview),
    confirm: vi.fn(async () => ({
      ...preview,
      status: 'in_progress' as const,
    })),
    status: vi.fn(async () => preview),
    discard: vi.fn(async () => {}),
  };
}
describe('confirmed event replacement', () => {
  it('previews without writing and passes the exact saved operation to confirmation', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      const controller = createEventReplacement(api, () => ({
        eventId: 'event',
        calendarId: 'calendar',
        recurrenceId: 'occurrence',
      }));
      controller.setOpen(true);
      expect(api.prepare).not.toHaveBeenCalled();
      controller.setOnlyOccurrence(true);
      await controller.prepare();
      expect(api.prepare).toHaveBeenCalledWith(
        {
          eventId: 'event',
          calendarId: 'calendar',
          recurrenceId: 'occurrence',
        },
        true
      );
      expect(api.confirm).not.toHaveBeenCalled();
      await controller.confirm();
      expect(api.confirm).toHaveBeenCalledWith('reviewed-operation');
      return dispose;
    });
    dispose();
  });
  it('a lost confirmation response retains the identity and prohibits discarding its preview', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      api.confirm = vi.fn(async () => {
        throw new Error('Connection interrupted');
      });
      const controller = createEventReplacement(api, () => ({
        eventId: 'event',
      }));
      await controller.prepare();
      await controller.confirm();
      expect(controller.confirmationAttempted()).toBe(true);
      expect(controller.preview()?.operationId).toBe('reviewed-operation');
      await controller.changeOptions();
      expect(api.discard).not.toHaveBeenCalled();
      await controller.check();
      expect(api.status).toHaveBeenCalledWith('reviewed-operation');
      expect(controller.confirmationAttempted()).toBe(false);
      await controller.changeOptions();
      expect(api.discard).toHaveBeenCalledWith('reviewed-operation');
      return dispose;
    });
    dispose();
  });
  it('reopening an in-progress operation cannot present it as a fresh confirmation', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      api.prepare = vi.fn(async () => ({
        ...preview,
        status: 'in_progress' as const,
        completedSteps: 1,
      }));
      const controller = createEventReplacement(api, () => ({
        eventId: 'event',
      }));
      await controller.prepare();
      expect(controller.confirmationAttempted()).toBe(true);
      controller.setOpen(false);
      controller.setOpen(true);
      expect(controller.preview()?.completedSteps).toBe(1);
      await controller.changeOptions();
      expect(api.discard).not.toHaveBeenCalled();
      return dispose;
    });
    dispose();
  });
});
