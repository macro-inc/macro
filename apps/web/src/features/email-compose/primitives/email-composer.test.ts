import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Real controller and editor, with only feature capabilities replaced.
describe('standalone compose controller', () => {
  it('saves a composed draft after debounce and preserves the recipients and HTML', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    try {
      root.edit('Keep this draft', 'Architecture');
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();
      const { draft } = vi.mocked(context.drafts.saveDraft).mock.calls[0][0];
      expect(draft.to).toEqual([
        expect.objectContaining({ email: 'colleague@example.com' }),
      ]);
      expect(draft.subject).toBe('Architecture');
      expect(decodeBase64Utf8(draft.body_html ?? '')).toContain(
        'Keep this draft'
      );
      expect(root.state.context.hasDraft()).toBe(true);
    } finally {
      root.dispose();
    }
  });

  it('rejects an empty body in an otherwise ready composer and sends once content is added', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    try {
      root.state.context.setSubject('Review');
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.validationError('no_message')).toMatchObject({
        type: 'no_message',
        message: 'Please enter a message',
      });
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      root.edit('Ready to send');
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
    }
  });

  it('keeps a picked time local and preserves it when explicit scheduling fails', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    try {
      root.edit('Schedule this reply', 'Schedule review');
      const requested = new Date('2026-10-01T12:00:00Z');
      vi.mocked(context.delivery.schedule).mockRejectedValueOnce(
        new Error('offline')
      );
      expect(root.state.context.schedule.onSelect(requested)).toBe(true);
      expect(root.state.context.schedule.selectedTime()).toEqual(requested);
      expect(context.delivery.schedule).not.toHaveBeenCalled();
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.schedule.selectedTime()).toEqual(requested);
      expect(root.state.context.schedule.state().type).toBe('editing');
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Failed to schedule email'
      );
      vi.mocked(context.delivery.archive).mockRejectedValueOnce(
        new Error('archive offline')
      );
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.schedule.confirmedTime()).toEqual(requested);
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Email scheduled, but unable to mark thread done'
      );
    } finally {
      root.dispose();
    }
  });

  it('blocks immediate send and overlapping changes while a scheduling request is pending', async () => {
    const pending = Promise.withResolvers<void>();
    const context = createComposeContext();
    vi.mocked(context.delivery.schedule).mockReturnValue(pending.promise);
    const root = mountEmailComposer(context);
    try {
      root.edit('Schedule this reply', 'Schedule review');
      root.state.context.schedule.onSelect(new Date('2026-10-01T12:00:00Z'));
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.schedule).toHaveBeenCalledOnce();
      expect(root.state.context.disabled()).toBe(true);
      root.state.context.onSend();
      expect(
        root.state.context.schedule.onSelect(new Date('2026-10-02T12:00:00Z'))
      ).toBe(false);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.delivery.schedule).toHaveBeenCalledOnce();
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.disabled()).toBe(true);
      expect(root.state.context.sendUnavailableReason?.()).toContain(
        'Scheduled for'
      );
      expect(root.state.draftDirty()).toBe(true);
    } finally {
      pending.resolve();
      root.dispose();
    }
  });
});
