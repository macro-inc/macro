import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EventReplacementSource } from '../context/event-replacement-source';
import type {
  EventReplacementPreview,
  EventReplacementRequest,
} from '../core/event-replacement';
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
const request: EventReplacementRequest = {
  target: {
    eventId: 'event',
    calendarId: 'calendar',
    recurrenceId: 'occurrence',
  },
  changes: { title: 'Review, moved' },
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
  it('previews the unsaved changes without writing and confirms the exact saved operation', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      const controller = createEventReplacement(api);
      await controller.start(request);
      expect(controller.open()).toBe(true);
      expect(api.prepare).toHaveBeenCalledWith(request);
      expect(controller.preview()?.operationId).toBe('reviewed-operation');
      expect(api.confirm).not.toHaveBeenCalled();
      await controller.confirm();
      expect(api.confirm).toHaveBeenCalledWith('reviewed-operation');
      return dispose;
    });
    dispose();
  });
  it('closing an unconfirmed preview discards it, and the next start shows the newer edits', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      const controller = createEventReplacement(api);
      await controller.start(request);
      controller.close();
      expect(api.discard).toHaveBeenCalledWith('reviewed-operation');
      expect(controller.preview()).toBeUndefined();
      const edited = { ...request, changes: { title: 'Review, again' } };
      await controller.start(edited);
      expect(api.prepare).toHaveBeenLastCalledWith(edited);
      return dispose;
    });
    dispose();
  });
  it('a lost confirmation response keeps its operation through closing and reopening', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      api.confirm = vi.fn(async () => {
        throw new Error('Connection interrupted');
      });
      const controller = createEventReplacement(api);
      await controller.start(request);
      await controller.confirm();
      expect(controller.confirmationAttempted()).toBe(true);
      controller.close();
      expect(api.discard).not.toHaveBeenCalled();
      await controller.start({ ...request, changes: {} });
      expect(api.prepare).toHaveBeenCalledTimes(1);
      expect(controller.preview()?.operationId).toBe('reviewed-operation');
      await controller.check();
      expect(api.status).toHaveBeenCalledWith('reviewed-operation');
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
      const controller = createEventReplacement(api);
      await controller.start(request);
      expect(controller.confirmationAttempted()).toBe(true);
      controller.close();
      await controller.start(request);
      expect(controller.preview()?.completedSteps).toBe(1);
      expect(api.prepare).toHaveBeenCalledTimes(1);
      expect(api.discard).not.toHaveBeenCalled();
      return dispose;
    });
    dispose();
  });
});
