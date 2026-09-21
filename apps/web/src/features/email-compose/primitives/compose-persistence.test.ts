import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PersistedEmailIdentity } from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';

const response: PersistedEmailIdentity = {
  draftId: 'saved-id',
  threadId: 'thread',
  inboxId: 'inbox',
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('flushes the latest pending body and envelope exactly once on disposal', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Last-second edit', 'Launch review');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  const { draft } = vi.mocked(composeContext.drafts.saveDraft).mock.calls[0][0];
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Last-second edit');
  expect(draft.subject).toBe('Launch review');
  expect(draft.to).toEqual([
    expect.objectContaining({ email: 'colleague@example.com' }),
  ]);
});
it('does not save an untouched composer or repeat a settled autosave on disposal', async () => {
  const composeContext = createComposeContext();
  const untouched = mountEmailComposer(composeContext);
  untouched.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).not.toHaveBeenCalled();
  const edited = mountEmailComposer(composeContext);
  edited.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  edited.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});
it('serializes a disposal flush behind the first save and reuses its returned ID', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Latest');
  root.dispose();
  await vi.advanceTimersByTimeAsync(600);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  const { draft } = vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0];
  expect(draft.db_id).toBe('saved-id');
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Latest');
});
it('discard cancels an unsaved debounce without creating a draft', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Discard me');
  await root.state.deleteDraftAndReset();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).not.toHaveBeenCalled();
  expect(composeContext.drafts.deleteDraft).not.toHaveBeenCalled();
});
it('discard waits for an in-flight first save and deletes its returned draft', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Discard these changes too');
  const discard = root.state.deleteDraftAndReset();
  root.dispose();
  pending.resolve(response);
  await discard;
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.drafts.deleteDraft).toHaveBeenCalledWith(
    expect.objectContaining({ draftId: 'saved-id' })
  );
});
it('keeps the draft editable after failed deletion and saves later edits', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(composeContext.drafts.deleteDraft).mockRejectedValueOnce(
    new Error('offline')
  );
  await expect(root.state.deleteDraftAndReset()).rejects.toThrow('offline');
  root.edit('Still here');
  await vi.advanceTimersByTimeAsync(600);
  root.dispose();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
});
it('waits for the saved draft ID, prevents duplicate sends, and does not recreate the sent draft on disposal', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('Send this');
  root.state.context.onSend();
  root.state.context.onSend();
  expect(root.state.context.disabled()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
  expect(
    vi.mocked(composeContext.delivery.sendMessage).mock.calls[0][0].message
      .db_id
  ).toBe('saved-id');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});
it('resumes autosave after a failed send', async () => {
  const composeContext = createComposeContext();
  vi.mocked(composeContext.delivery.sendMessage).mockRejectedValueOnce(
    new Error('offline')
  );
  const root = mountEmailComposer(composeContext);
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.state.context.disabled()).toBe(false);
  root.edit('Retry with this');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  expect(
    composeContext.notices.feedback.failure
  ).toHaveBeenCalledExactlyOnceWith('Failed to send email');
});

it('keeps a successful send completed when navigation fails', async () => {
  const composeContext = createComposeContext();
  const error = new Error('Navigation failed');
  const root = mountEmailComposer(composeContext, {
    showThread: () => {
      throw error;
    },
  });
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.notices.reportError).toHaveBeenCalledWith(error);
  expect(composeContext.notices.feedback.failure).not.toHaveBeenCalled();
  root.state.context.onSend();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});

it('keeps completion independent when two composers share delivery capabilities', async () => {
  const composeContext = createComposeContext();
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  vi.mocked(composeContext.delivery.sendMessage).mockReturnValueOnce(
    pending.promise
  );
  const first = mountEmailComposer(composeContext);
  const second = mountEmailComposer(composeContext);
  first.edit('First');
  second.edit('Second');
  first.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  second.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledTimes(2);
  expect(first.state.context.isSending()).toBe(true);
  expect(second.state.context.isSending()).toBe(false);
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(first.state.context.isSending()).toBe(false);
  first.dispose();
  second.dispose();
});
it('waits for an existing attachment upload before flushing newer body edits', async () => {
  const pending = Promise.withResolvers<void>();
  const composeContext = createComposeContext();
  vi.mocked(
    composeContext.attachmentStorage.uploadAttachments
  ).mockReturnValueOnce(pending.promise);
  const root = mountEmailComposer(composeContext);
  root.edit('With attachment');
  root.state.context.onAddAttachments([
    {
      type: 'local',
      file: new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Final attachment note');
  root.dispose();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  expect(
    vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0].draft.db_id
  ).toBe('draft');
});

it('rejects sender/schedule changes and repeated discard while a deletion is pending', async () => {
  const pending = Promise.withResolvers<void>();
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(composeContext.drafts.deleteDraft).mockReturnValueOnce(
    pending.promise
  );
  const discard = root.state.deleteDraftAndReset();
  expect(await root.state.deleteDraftAndReset()).toBe(false);
  root.state.context.onSelectInbox?.('other-inbox');
  root.state.context.schedule.onSelect(new Date('2026-12-01T12:00:00Z'));
  expect(root.state.context.selectedInboxId?.()).toBe('inbox');
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  pending.resolve();
  expect(await discard).toBe(true);
  root.dispose();
});

it('rejects sender and scheduling changes after send dispatch', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  vi.mocked(composeContext.delivery.sendMessage).mockReturnValueOnce(
    pending.promise
  );
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  root.state.context.onSelectInbox?.('other-inbox');
  root.state.context.schedule.onSelect(new Date('2026-12-01T12:00:00Z'));
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(root.state.context.selectedInboxId?.()).toBe('inbox');
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  root.dispose();
});

it('uses the captured inbox for attachment upload when a sender switch queues behind a save', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  composeContext.accounts = {
    ...composeContext.accounts,
    inboxes: () => [
      { id: 'inbox', email_address: 'me@example.com', settings: {} },
      { id: 'other', email_address: 'other@example.com', settings: {} },
    ],
  };
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('With files');
  root.state.context.onAddAttachments([
    { type: 'local', file: new File(['notes'], 'notes.txt') },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  root.state.context.onSelectInbox?.('other');
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(
    vi.mocked(composeContext.attachmentStorage.uploadAttachments).mock
      .calls[0][0].inboxId
  ).toBe('inbox');
  expect(
    vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0].inboxId
  ).toBe('other');
  root.dispose();
});

it('keeps a selected or cleared time inert while ordinary autosave continues', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  const selected = new Date('2026-12-01T12:00:00Z');
  root.edit('Autosave this scheduled-send preparation');
  expect(root.state.context.schedule.onSelect(selected)).toBe(true);
  await vi.advanceTimersByTimeAsync(600);

  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(
    vi.mocked(composeContext.drafts.saveDraft).mock.calls[0][0]
  ).not.toHaveProperty('sendTime');
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(composeContext.delivery.unschedule).not.toHaveBeenCalled();
  expect(composeContext.delivery.archive).not.toHaveBeenCalled();

  expect(root.state.context.schedule.onSelect(null)).toBe(true);
  expect(root.state.context.schedule.selectedTime()).toBeUndefined();
  expect(composeContext.delivery.unschedule).not.toHaveBeenCalled();
  root.dispose();
});

it('only commits a selected time through the primary action', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Schedule this');
  const firstTime = new Date('2026-12-01T12:00:00Z');
  expect(root.state.context.schedule.onSelect(firstTime)).toBe(true);
  expect(root.state.context.schedule.selectedTime()).toEqual(firstTime);
  expect(root.state.context.deliveryState?.()).toBe('draft');
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(composeContext.delivery.unschedule).not.toHaveBeenCalled();
  expect(composeContext.notices.feedback.success).not.toHaveBeenCalled();

  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  expect(composeContext.delivery.schedule).toHaveBeenCalledExactlyOnceWith(
    {
      draftId: 'draft',
      sendTime: firstTime.toISOString(),
      includeSignature: undefined,
    },
    'inbox'
  );
  expect(root.state.context.schedule.confirmedTime()).toEqual(firstTime);
  expect(root.state.context.deliveryState?.()).toBe('scheduled');
  expect(composeContext.notices.feedback.success).toHaveBeenCalledWith(
    'Email scheduled for Dec 1, 2026 at 12:00 PM'
  );
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.schedule).toHaveBeenCalledOnce();
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  root.dispose();
});

it('preserves local intent on schedule failure without falling back to send', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Schedule carefully');
  const sendTime = new Date('2026-12-01T12:00:00Z');
  vi.mocked(composeContext.delivery.schedule).mockRejectedValueOnce(
    new Error('schedule offline')
  );

  expect(root.state.context.schedule.onSelect(sendTime)).toBe(true);
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.state.context.schedule.selectedTime()).toEqual(sendTime);
  expect(root.state.context.schedule.state().type).toBe('editing');
  expect(composeContext.notices.feedback.failure).toHaveBeenCalledWith(
    'Failed to schedule email'
  );
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  root.dispose();
});

it('stops an open scheduled composer when delivery is observed', async () => {
  const composeContext = createComposeContext();
  const showThread = vi.fn();
  const root = mountEmailComposer(composeContext, { showThread });
  root.edit('Deliver this');
  root.state.context.schedule.onSelect(new Date('2026-12-01T12:00:00Z'));
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  showThread.mockClear();

  composeContext.setDraftLifecycle({
    type: 'sent',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);

  expect(root.state.context.deliveryState?.()).toBe('sent');
  expect(root.state.context.disabled()).toBe(true);
  expect(showThread).toHaveBeenCalledExactlyOnceWith('thread');
  expect(composeContext.notices.feedback.success).toHaveBeenCalledWith(
    'Scheduled email sent'
  );
  root.state.context.onSend();
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.deleteDraft).not.toHaveBeenCalled();
});

it('reconciles an external schedule and cancellation while the composer is open', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Coordinate this draft');
  await vi.advanceTimersByTimeAsync(600);
  const sendTime = '2026-12-01T12:00:00Z';

  composeContext.setDraftLifecycle({
    type: 'scheduled',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    sendTime,
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(root.state.context.schedule.confirmedTime()).toEqual(
    new Date(sendTime)
  );
  expect(root.state.context.disabled()).toBe(true);

  composeContext.setDraftLifecycle({
    type: 'editing',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(root.state.context.schedule.confirmedTime()).toBeUndefined();
  expect(root.state.context.disabled()).toBe(false);
  expect(composeContext.notices.feedback.success).toHaveBeenCalledWith(
    'Schedule cancelled. This email is editable again.'
  );
  root.dispose();
});

it('keeps the confirmed time authoritative until update or cancellation succeeds', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Manage this schedule');
  await vi.advanceTimersByTimeAsync(600);
  const original = new Date('2026-12-01T12:00:00Z');
  const replacement = new Date('2026-12-02T14:30:00Z');
  composeContext.setDraftLifecycle({
    type: 'scheduled',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    sendTime: original.toISOString(),
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);

  expect(root.state.context.schedule.onSelect(replacement)).toBe(true);
  expect(root.state.context.schedule.confirmedTime()).toEqual(original);
  expect(root.state.context.schedule.selectedTime()).toEqual(replacement);
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(root.state.context.schedule.onSelect(null)).toBe(true);
  expect(root.state.context.schedule.confirmedTime()).toEqual(original);
  expect(composeContext.delivery.unschedule).not.toHaveBeenCalled();

  root.state.context.schedule.onSelect(replacement);
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.schedule).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      draftId: 'draft',
      sendTime: replacement.toISOString(),
    }),
    'inbox'
  );
  expect(root.state.context.schedule.confirmedTime()).toEqual(replacement);
  composeContext.setDraftLifecycle({
    type: 'scheduled',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    sendTime: replacement.toISOString(),
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);

  vi.mocked(composeContext.delivery.unschedule).mockRejectedValueOnce(
    new Error('cancel offline')
  );
  expect(await root.state.context.schedule.onCancel()).toBe(false);
  expect(root.state.context.schedule.confirmedTime()).toEqual(replacement);
  expect(composeContext.notices.feedback.failure).toHaveBeenCalledWith(
    'Failed to cancel schedule'
  );

  expect(await root.state.context.schedule.onCancel()).toBe(true);
  expect(root.state.context.schedule.state().type).toBe('editing');
  expect(root.state.context.disabled()).toBe(false);
  root.dispose();
});

it('blocks a past local time at submission without sending immediately', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Do not send early');
  const past = new Date(Date.now() - 1_000);
  expect(root.state.context.schedule.onSelect(past)).toBe(true);
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(0);
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  expect(composeContext.notices.feedback.alert).toHaveBeenCalledWith(
    'That send time has passed. Choose a future time.'
  );
  expect(root.state.context.schedule.selectedTime()).toEqual(past);
  root.dispose();
});

it('ignores a stale autosave response and preserves a racing edit under a new draft ID', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Persisted version');
  await vi.advanceTimersByTimeAsync(600);
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  root.edit('New text that raced delivery');
  await vi.advanceTimersByTimeAsync(600);

  composeContext.setDraftLifecycle({
    type: 'sent',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);
  pending.resolve({ draftId: 'draft', threadId: 'thread', inboxId: 'inbox' });
  await vi.advanceTimersByTimeAsync(0);

  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(3);
  const preserved = vi.mocked(composeContext.drafts.saveDraft).mock.calls[2][0]
    .draft;
  expect(preserved.db_id).toBeUndefined();
  expect(decodeBase64Utf8(preserved.body_html ?? '')).toContain(
    'New text that raced delivery'
  );
  expect(composeContext.notices.feedback.alert).toHaveBeenCalledWith(
    'The scheduled email was sent while you were editing. Your newer text was kept as a new draft and was not sent.'
  );
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  root.dispose();
});

it('reports delivery specifically when it races draft deletion', async () => {
  const composeContext = createComposeContext();
  const showThread = vi.fn();
  const root = mountEmailComposer(composeContext, { showThread });
  root.edit('Saved before delete');
  await vi.advanceTimersByTimeAsync(600);
  const pending = Promise.withResolvers<void>();
  vi.mocked(composeContext.drafts.deleteDraft).mockReturnValueOnce(
    pending.promise
  );

  const deletion = root.state.deleteDraftAndReset();
  composeContext.setDraftLifecycle({
    type: 'sent',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  pending.reject(new Error('message already sent'));
  await expect(deletion).rejects.toThrow('message already sent');
  await vi.advanceTimersByTimeAsync(0);

  expect(composeContext.notices.feedback.failure).not.toHaveBeenCalledWith(
    'Failed to delete draft'
  );
  expect(composeContext.notices.feedback.alert).toHaveBeenCalledWith(
    'This scheduled email was sent. Your composer has been updated.'
  );
  expect(showThread).toHaveBeenCalledWith('thread');
  root.dispose();
});

it.each([true, false])(
  'does not send a recovery draft when pre-send persistence discovers delivery (immediate effect: %s)',
  async (immediateEffect) => {
    const context = createComposeContext();
    const root = mountEmailComposer(context);
    root.edit('Previously saved');
    await vi.advanceTimersByTimeAsync(600);
    const lifecycle = vi.mocked(context.draftLifecycle.observe).mock.results[0]
      .value;
    const sent = {
      type: 'sent' as const,
      draftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
      observedAt: Date.now(),
    };
    vi.mocked(lifecycle.refresh).mockImplementationOnce(async () => {
      if (immediateEffect) context.setDraftLifecycle(sent);
      return sent;
    });
    vi.mocked(context.drafts.saveDraft)
      .mockRejectedValueOnce(new Error('Message already sent'))
      .mockResolvedValue({ ...response, draftId: 'recovered' });
    root.edit('Keep this newer text unsent');
    root.state.context.onSend();
    await vi.advanceTimersByTimeAsync(0);

    expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    if (!immediateEffect) {
      expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
      // The refresh result already stopped Send before Solid applies the state.
      context.setDraftLifecycle(sent);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(context.drafts.saveDraft).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(context.drafts.saveDraft).mock.lastCall?.[0].draft.db_id
    ).toBeUndefined();
    expect(root.state.context.disabled()).toBe(false);
    root.dispose();
  }
);

it('recovers local and forwarded attachments without retaining remote-only attachment pills', async () => {
  const context = createComposeContext();
  vi.mocked(context.attachmentStorage.uploadAttachments).mockImplementation(
    async (input) => {
      for (const file of input.attachments)
        input.onAttachmentAdded?.(file, `${input.draftId}-attachment`);
    }
  );
  const root = mountEmailComposer(context);
  const file = new File(['notes'], 'notes.txt');
  root.edit('Saved with files');
  root.state.context.onAddAttachments([
    { type: 'local', file },
    {
      type: 'remote',
      attachmentId: 'remote',
      url: 'https://example.com/file',
      fileName: 'remote.txt',
      contentType: 'text/plain',
      fileSize: 10,
    },
    {
      type: 'forwarded',
      attachmentId: 'original-file',
      fileName: 'forward.txt',
      mimeType: 'text/plain',
      fileSize: 10,
    },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(context.drafts.saveDraft).mockResolvedValue({
    ...response,
    draftId: 'recovered',
  });
  root.edit('New text to recover');
  context.setDraftLifecycle({
    type: 'sent',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);

  expect(context.attachmentStorage.uploadAttachments).toHaveBeenCalledTimes(2);
  expect(context.attachmentStorage.uploadAttachments).toHaveBeenLastCalledWith(
    expect.objectContaining({ draftId: 'recovered', attachments: [file] })
  );
  expect(
    context.attachmentStorage.addForwardedAttachments
  ).toHaveBeenLastCalledWith(
    expect.objectContaining({
      draftId: 'recovered',
      attachments: [{ attachmentId: 'original-file' }],
    })
  );
  expect(
    root.state.context
      .attachments()
      .map((attachment) => attachment.attachmentId)
  ).toEqual(['recovered-attachment', 'original-file']);
  expect(context.notices.feedback.alert).toHaveBeenCalledWith(
    'Previously saved attachments could not be copied to the new draft. Please attach those files again.'
  );
  root.dispose();
});
