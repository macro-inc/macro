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

  it('reports scheduling failure without adopting an unconfirmed time, and keeps a confirmed schedule when archive fails', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    try {
      root.edit('Schedule this reply', 'Schedule review');
      const requested = new Date('2026-10-01T12:00:00Z');
      vi.mocked(context.delivery.schedule).mockRejectedValueOnce(
        new Error('offline')
      );
      await root.state.context.onSendTimeChange?.(requested);
      expect(root.state.context.sendTime()).toBeFalsy();
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Failed to schedule message'
      );
      vi.mocked(context.delivery.archive).mockRejectedValueOnce(
        new Error('archive offline')
      );
      await root.state.context.onSendTimeChange?.(requested);
      expect(root.state.context.sendTime()).toEqual(requested);
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
      const request = root.state.context.onSendTimeChange?.(
        new Date('2026-10-01T12:00:00Z')
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.schedule).toHaveBeenCalledOnce();
      expect(root.state.context.disabled()).toBe(true);
      root.state.context.onSend();
      await root.state.context.onSendTimeChange?.(
        new Date('2026-10-02T12:00:00Z')
      );
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.delivery.schedule).toHaveBeenCalledOnce();
      pending.resolve();
      await request;
      expect(root.state.context.disabled()).toBe(false);
      expect(root.state.draftDirty()).toBe(true);
    } finally {
      pending.resolve();
      root.dispose();
    }
  });
});
