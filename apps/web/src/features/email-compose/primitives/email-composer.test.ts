import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Real controller and editor, with only feature capabilities replaced.
describe('standalone compose controller', () => {
  it.each([
    {
      initialInboxId: undefined,
      expectedId: 'inbox',
      expectedAddress: 'me@example.com',
    },
    {
      initialInboxId: 'work',
      expectedId: 'work',
      expectedAddress: 'work@example.com',
    },
  ])(
    'uses $expectedAddress as the initial sender and saves to that inbox',
    async ({ initialInboxId, expectedId, expectedAddress }) => {
      const context = createComposeContext();
      context.accounts.inboxes = () => [
        { id: 'work', email_address: 'work@example.com', settings: {} },
        { id: 'inbox', email_address: 'me@example.com', settings: {} },
      ];
      const root = mountEmailComposer(context, undefined, { initialInboxId });
      try {
        expect(root.state.context.fromAddress?.()).toBe(expectedAddress);
        root.edit('Save with the selected sender');
        await vi.advanceTimersByTimeAsync(600);
        expect(context.drafts.saveDraft).toHaveBeenCalledWith(
          expect.objectContaining({ inboxId: expectedId })
        );
      } finally {
        root.dispose();
      }
    }
  );

  it('blocks sending when an explicit initial inbox cannot be resolved', async () => {
    const context = createComposeContext();
    const root = mountEmailComposer(context, undefined, {
      initialInboxId: 'removed-inbox',
    });
    try {
      root.edit('Send only from the selected inbox');
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(600);

      expect(root.state.context.fromAddress?.()).toBeUndefined();
      expect(root.state.context.validationError('no_link')).toMatchObject({
        type: 'no_link',
        message: 'Unable to find linked email account',
      });
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  });

  it.each([undefined, 'missing-primary'])(
    'falls back to the first inbox without an explicit selection when primary is %s',
    async (primaryId) => {
      const context = createComposeContext();
      context.accounts.primaryId = () => primaryId;
      const root = mountEmailComposer(context);
      try {
        root.edit('Use the default sender');
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);

        expect(root.state.context.fromAddress?.()).toBe('me@example.com');
        expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
        expect(context.delivery.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ inboxId: 'inbox' })
        );
      } finally {
        root.dispose();
      }
    }
  );

  it('keeps a draft sender instead of the initial inbox and still allows a sender change', async () => {
    const context = createComposeContext();
    context.accounts.inboxes = () => [
      { id: 'inbox', email_address: 'me@example.com', settings: {} },
      { id: 'work', email_address: 'work@example.com', settings: {} },
    ];
    const root = mountEmailComposer(context, undefined, {
      draft: message('existing-draft', { is_draft: true, link_id: 'work' }),
      initialInboxId: 'inbox',
    });
    try {
      expect(root.state.context.fromAddress?.()).toBe('work@example.com');
      root.state.context.onSelectInbox?.('inbox');
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.context.fromAddress?.()).toBe('me@example.com');
      expect(context.drafts.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ inboxId: 'inbox' })
      );
    } finally {
      root.dispose();
    }
  });

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
