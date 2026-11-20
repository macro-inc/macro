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
      // The server started the replacement before the response was lost.
      api.status = vi.fn(async () => ({
        ...preview,
        status: 'in_progress' as const,
        completedSteps: 1,
      }));
      const controller = createEventReplacement(api);
      await controller.start(request);
      await controller.confirm();
      expect(controller.confirmationAttempted()).toBe(true);
      controller.close();
      expect(api.discard).not.toHaveBeenCalled();
      await controller.start({ ...request, changes: {} });
      expect(api.status).toHaveBeenCalledWith('reviewed-operation');
      expect(api.prepare).toHaveBeenCalledTimes(1);
      expect(controller.preview()?.operationId).toBe('reviewed-operation');
      expect(controller.preview()?.status).toBe('in_progress');
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
  it('a preview superseded while it loads is discarded and the newer edits are prepared', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      let answerFirst!: (value: EventReplacementPreview) => void;
      api.prepare = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<EventReplacementPreview>((resolve) => {
              answerFirst = resolve;
            })
        )
        .mockResolvedValue({ ...preview, operationId: 'newer-operation' });
      const controller = createEventReplacement(api);
      const first = controller.start(request);
      controller.close();
      const edited = { ...request, changes: { title: 'Review, fixed' } };
      const second = controller.start(edited);
      answerFirst({ ...preview, operationId: 'older-operation' });
      await Promise.all([first, second]);
      expect(api.discard).toHaveBeenCalledWith('older-operation');
      expect(api.prepare).toHaveBeenLastCalledWith(edited);
      expect(controller.preview()?.operationId).toBe('newer-operation');
      return dispose;
    });
    dispose();
  });
  it('a preview that loads after closing is discarded', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      let answer!: (value: EventReplacementPreview) => void;
      api.prepare = vi.fn(
        () =>
          new Promise<EventReplacementPreview>((resolve) => {
            answer = resolve;
          })
      );
      const controller = createEventReplacement(api);
      const started = controller.start(request);
      controller.close();
      answer(preview);
      await started;
      expect(api.discard).toHaveBeenCalledWith('reviewed-operation');
      expect(api.prepare).toHaveBeenCalledTimes(1);
      expect(controller.preview()).toBeUndefined();
      return dispose;
    });
    dispose();
  });
  it('after Outlook refuses the confirmation, the next start carries the newer edits', async () => {
    const dispose = await createRoot(async (dispose) => {
      const api = source();
      api.confirm = vi.fn(async () => {
        throw new Error('Outlook refused the new event');
      });
      const controller = createEventReplacement(api);
      await controller.start(request);
      await controller.confirm();
      controller.close();
      const edited = { ...request, changes: { title: 'Review, fixed' } };
      await controller.start(edited);
      expect(api.status).toHaveBeenCalledWith('reviewed-operation');
      expect(api.prepare).toHaveBeenLastCalledWith(edited);
      return dispose;
    });
    dispose();
  });
});
