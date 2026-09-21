import { emailKeys } from '@queries/email/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type {
  EmailComposeContext,
  PersistedEmailIdentity,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { emailDraftLifecycleSource } from '../queries/draft-lifecycle';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

const fetchLifecycleThread = vi.hoisted(() => vi.fn());
vi.mock('@queries/email/thread', () => ({
  fetchFreshEmailThread: fetchLifecycleThread,
}));
vi.mock('@core/cross-tab/cross-tab-bus', () => ({
  createCrossTabBus: () => ({ publish() {}, subscribe: () => () => {} }),
}));

function composer(
  kind: 'standalone' | 'reply',
  composeContext: EmailComposeContext
) {
  if (kind === 'reply') {
    const state = mountReplyComposer(composeContext);
    return {
      dispose: state.dispose,
      edit: state.edit,
      switchInbox: state.persistDraftOnSenderSwitch,
      selectedInbox: state.activeInboxId,
      disabled: state.editingDisabled,
      selectedTime: state.selectedSendTime,
      confirmedTime: state.confirmedSendTime,
      scheduleState: state.scheduleState,
      send: () => state.sendEmail(),
      selectTime: state.handleSendTimeChange,
      cancelSchedule: state.cancelSchedule,
    };
  }
  const root = mountEmailComposer(composeContext);
  root.edit('Ready to send');
  return {
    dispose: root.dispose,
    edit: root.edit,
    switchInbox: root.state.context.onSelectInbox!,
    selectedInbox: () => root.state.context.selectedInboxId?.(),
    disabled: root.state.context.disabled,
    selectedTime: root.state.context.schedule.selectedTime,
    confirmedTime: root.state.context.schedule.confirmedTime,
    scheduleState: root.state.context.schedule.state,
    send: root.state.context.onSend,
    selectTime: root.state.context.schedule.onSelect,
    cancelSchedule: root.state.context.schedule.onCancel,
  };
}

function composerWithLifecycleQuery(
  kind: 'standalone' | 'reply',
  context: EmailComposeContext
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let state!: ReturnType<typeof composer>;
  const disposeProvider = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        state = composer(kind, {
          ...context,
          draftLifecycle: emailDraftLifecycleSource,
        });
        return null;
      },
    });
    return dispose;
  });
  return {
    ...state,
    client,
    dispose() {
      state.dispose();
      disposeProvider();
      client.clear();
    },
  };
}

describe('send and schedule ordering', () => {
  it.each(['standalone', 'reply'] as const)(
    '%s keeps an unconfirmed time local across an editing refresh',
    async (kind) => {
      const context = createComposeContext();
      const state = composer(kind, context);
      const selected = new Date('2026-12-01T12:00:00Z');
      try {
        expect(state.selectTime(selected)).toBe(true);
        context.setDraftLifecycle({
          type: 'editing',
          draftId: 'draft',
          threadId: 'thread',
          inboxId: 'inbox',
          observedAt: Date.now(),
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(state.selectedTime()).toEqual(selected);
        expect(state.scheduleState().type).toBe('editing');
        expect(state.disabled()).toBe(false);
        expect(context.delivery.schedule).not.toHaveBeenCalled();
        expect(context.delivery.unschedule).not.toHaveBeenCalled();
        expect(context.delivery.archive).not.toHaveBeenCalled();
      } finally {
        state.dispose();
      }
    }
  );

  it.each(['standalone', 'reply'] as const)(
    '%s discards deferred missing state when migration and its refresh fail',
    async (kind) => {
      const context = createComposeContext();
      context.accounts.inboxes = () => [
        { id: 'inbox', email_address: 'me@example.com', settings: {} },
        { id: 'other', email_address: 'other@example.com', settings: {} },
      ];
      fetchLifecycleThread.mockReset().mockResolvedValueOnce({
        messages: [message('draft', { is_draft: true })],
      });
      const state = composerWithLifecycleQuery(kind, context);
      const notifications: VoidFunction[] = [];
      let queueNotification: ReturnType<typeof vi.spyOn> | undefined;
      try {
        state.edit('Keep this draft');
        await vi.advanceTimersByTimeAsync(600);
        const moving = Promise.withResolvers<PersistedEmailIdentity>();
        vi.mocked(context.drafts.saveDraft).mockReturnValueOnce(moving.promise);
        state.switchInbox('other');
        await vi.advanceTimersByTimeAsync(0);
        expect(state.disabled()).toBe(true);

        // A read during migration cannot establish the final draft state.
        fetchLifecycleThread.mockResolvedValueOnce({ messages: [] });
        await state.client.invalidateQueries({
          queryKey: emailKeys.composeDraftState._def,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(context.notices.feedback.alert).not.toHaveBeenCalled();

        const failure = new Error('Lifecycle unavailable');
        fetchLifecycleThread.mockRejectedValueOnce(failure);
        queueNotification = vi
          .spyOn(globalThis, 'queueMicrotask')
          .mockImplementation((callback) => notifications.push(callback));
        moving.reject(new Error('Move failed'));
        await vi.advanceTimersByTimeAsync(0);
        expect(context.notices.reportError).toHaveBeenCalledWith(failure);
        expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
        expect(context.notices.feedback.alert).not.toHaveBeenCalled();
        expect(state.disabled()).toBe(false);

        queueNotification.mockRestore();
        for (const notify of notifications.splice(0)) notify();
        fetchLifecycleThread.mockResolvedValueOnce({
          messages: [message('draft', { is_draft: true })],
        });
        await state.client.invalidateQueries({
          queryKey: emailKeys.composeDraftState._def,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
        expect(context.notices.feedback.alert).not.toHaveBeenCalled();
      } finally {
        queueNotification?.mockRestore();
        for (const notify of notifications) notify();
        state.dispose();
      }
    }
  );

  it('does not send a reply when delivery overtakes its pre-send save', async () => {
    const context = createComposeContext();
    const state = mountReplyComposer(context);
    state.edit('Previously saved');
    await vi.advanceTimersByTimeAsync(600);
    const pending = Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(context.drafts.saveDraft)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({
        draftId: 'recovered',
        threadId: 'thread',
        inboxId: 'inbox',
      });
    state.edit('Keep this newer reply unsent');
    const sending = state.sendEmail();
    await vi.advanceTimersByTimeAsync(0);
    context.setDraftLifecycle({
      type: 'sent',
      draftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
      observedAt: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);
    pending.resolve({ draftId: 'draft', threadId: 'thread', inboxId: 'inbox' });
    await sending;
    await vi.advanceTimersByTimeAsync(0);

    expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    expect(state.savedDraftId()).toBe('recovered');
    expect(decodeBase64Utf8(state.collectDraft()?.body_html ?? '')).toContain(
      'Keep this newer reply unsent'
    );
    state.dispose();
  });

  it.each(['standalone', 'reply'] as const)(
    '%s observes the persisted inbox and ignores missing responses during migration',
    async (kind) => {
      const context = createComposeContext();
      context.accounts = {
        ...context.accounts,
        inboxes: () => [
          { id: 'inbox', email_address: 'me@example.com', settings: {} },
          { id: 'other', email_address: 'other@example.com', settings: {} },
          { id: 'third', email_address: 'third@example.com', settings: {} },
        ],
      };
      const state = composer(kind, context);
      state.edit('Move this draft');
      await vi.advanceTimersByTimeAsync(600);
      const identity = vi.mocked(context.draftLifecycle.observe).mock
        .calls[0][0];
      const pending = Promise.withResolvers<PersistedEmailIdentity>();
      vi.mocked(context.drafts.saveDraft).mockReturnValueOnce(pending.promise);
      state.switchInbox('other');
      await vi.advanceTimersByTimeAsync(0);
      state.switchInbox('third');
      expect(state.selectedInbox()).toBe('other');
      expect(identity.inboxId()).toBe('inbox');
      expect(identity.draftId()).toBe('draft');
      context.setDraftLifecycle({
        type: 'missing',
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'other',
        observedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      // The server deletes the old inbox's draft before the migration response.
      context.setDraftLifecycle({
        type: 'missing',
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        observedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(context.notices.feedback.alert).not.toHaveBeenCalled();
      pending.resolve({
        draftId: 'moved',
        threadId: 'moved-thread',
        inboxId: 'other',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect([
        identity.draftId(),
        identity.threadId(),
        identity.inboxId(),
      ]).toEqual(['moved', 'moved-thread', 'other']);
      expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
      expect(state.selectedInbox()).toBe('other');
      expect(context.notices.feedback.alert).not.toHaveBeenCalled();
      expect(state.disabled()).toBe(false);
      state.dispose();
    }
  );

  it.each(['standalone', 'reply'] as const)(
    '%s defers stale observations until schedule reconciliation completes',
    async (kind) => {
      const context = createComposeContext();
      const state = composer(kind, context);
      const pending = Promise.withResolvers<void>();
      vi.mocked(context.delivery.archive).mockReturnValueOnce(pending.promise);
      const lifecycle = vi.mocked(context.draftLifecycle.observe).mock
        .results[0].value;
      const scheduled = {
        type: 'scheduled' as const,
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        sendTime: '2026-12-01T12:00:00Z',
        observedAt: Date.now(),
      };
      vi.mocked(lifecycle.refresh).mockImplementationOnce(async () => {
        context.setDraftLifecycle(scheduled);
        return scheduled;
      });
      state.selectTime(new Date(scheduled.sendTime));
      const scheduling = state.send();
      await vi.advanceTimersByTimeAsync(0);
      context.setDraftLifecycle({
        type: 'editing',
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        observedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(state.selectedTime()).toEqual(new Date(scheduled.sendTime));
      pending.resolve();
      await scheduling;
      if (kind === 'standalone') {
        expect(state.confirmedTime()).toEqual(new Date(scheduled.sendTime));
        expect(state.disabled()).toBe(true);
      } else {
        // Inline reply follows its normal successful-submit convention and
        // collapses; a stale editing observation must not surface a cancel.
        expect(state.scheduleState().type).toBe('editing');
      }
      expect(context.notices.feedback.success).not.toHaveBeenCalledWith(
        'Schedule cancelled. This email is editable again.'
      );
      state.dispose();
    }
  );
  it('keeps reply recipients unchanged while a schedule is pending', async () => {
    const context = createComposeContext();
    const pending = Promise.withResolvers<void>();
    vi.mocked(context.delivery.schedule).mockReturnValueOnce(pending.promise);
    const state = mountReplyComposer(context);
    const originalTo = [...state.form.recipients().to];
    expect(state.handleSendTimeChange(new Date('2026-12-01T12:00:00Z'))).toBe(
      true
    );
    expect(context.delivery.schedule).not.toHaveBeenCalled();
    const scheduling = state.sendEmail();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.schedule).toHaveBeenCalledOnce();
      expect(state.sendActionDisabled()).toBe(true);
      state.recipients.setRecipients('to', []);
      state.recipients.handleRecipientDrop('cc', originalTo[0], 'to');
      expect(state.form.recipients().to).toEqual(originalTo);
      expect(state.form.recipients().cc).toEqual([]);
      pending.resolve();
      await scheduling;
      expect(context.delivery.unschedule).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    } finally {
      pending.resolve();
      await scheduling;
      state.dispose();
    }
  });

  it('ignores confirmed-schedule edits and quoted-text toggles', async () => {
    const context = createComposeContext();
    const state = mountReplyComposer(context);
    try {
      state.edit('Persist before scheduling elsewhere');
      await vi.advanceTimersByTimeAsync(600);
      context.setDraftLifecycle({
        type: 'scheduled',
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        sendTime: '2026-12-01T12:00:00Z',
        observedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(state.confirmedSendTime()).toEqual(
        new Date('2026-12-01T12:00:00Z')
      );

      state.scheduleDraftSave();
      state.toggleQuotedText();
      expect(state.form.replyAppended()).toBe(false);

      context.setDraftLifecycle({
        type: 'sent',
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        observedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(context.notices.feedback.success).toHaveBeenCalledWith(
        'Scheduled email sent'
      );
    } finally {
      state.dispose();
    }
  });

  it('undoes only the mark-done belonging to the selected send', async () => {
    const context = createComposeContext();
    const first = {
      draftId: 'first-send',
      threadId: 'thread',
      inboxId: 'inbox',
    };
    const second = { ...first, draftId: 'second-send' };
    vi.mocked(context.drafts.saveDraft)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.mocked(context.delivery.sendMessage)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.mocked(context.delivery.undoSend).mockImplementation(
      async ({ onUndone }) => {
        await onUndone();
      }
    );
    const undoFirst = vi.fn(async () => {});
    const undoSecond = vi.fn(async () => {});
    const onMarkDone = vi
      .fn()
      .mockImplementationOnce((options) =>
        options.onUndoHandle({ id: 'first', undo: undoFirst, dispose() {} })
      )
      .mockImplementationOnce((options) =>
        options.onUndoHandle({ id: 'second', undo: undoSecond, dispose() {} })
      );
    const state = mountReplyComposer(context, undefined, { onMarkDone });
    try {
      await state.sendEmail(true);
      const firstNotice = vi.mocked(context.notices.feedback.success).mock
        .lastCall;
      state.edit('Another reply');
      await state.sendEmail(true);
      expect(context.delivery.sendMessage).toHaveBeenCalledTimes(2);
      firstNotice?.[1]?.actions?.[0].onClick();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.restoreDraft).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: first.draftId })
      );
      expect(undoFirst).toHaveBeenCalledOnce();
      expect(undoSecond).not.toHaveBeenCalled();
    } finally {
      state.dispose();
    }
  });

  it('undoes mark-done while the post-send refresh is still pending', async () => {
    const composeContext = createComposeContext();
    const { promise: refresh, resolve: finish } = Promise.withResolvers<void>();
    const undo = vi.fn(async () => {});
    const onMarkDone = vi.fn((options) =>
      options.onUndoHandle({ id: 'done', undo, dispose() {} })
    );
    vi.mocked(composeContext.delivery.undoSend).mockImplementation(
      async ({ onUndone }) => {
        await onUndone();
      }
    );
    const state = mountReplyComposer(composeContext, undefined, {
      sideEffectOnSend: () => refresh,
      onMarkDone,
    });
    try {
      const send = state.sendEmail(true);
      await vi.advanceTimersByTimeAsync(0);
      const sentNotice = vi
        .mocked(composeContext.notices.feedback.success)
        .mock.calls.find(([text]) => text === 'Email sent');
      expect(onMarkDone).toHaveBeenCalledOnce();
      expect(onMarkDone).toHaveBeenCalledWith(
        expect.objectContaining({ silent: true, navigate: false })
      );
      sentNotice?.[1]?.actions?.[0].onClick();
      await vi.advanceTimersByTimeAsync(0);
      expect(undo).toHaveBeenCalledOnce();
      expect(state.isSending()).toBe(false);
      state.edit('Restored reply edited before refresh');
      await vi.advanceTimersByTimeAsync(600);
      expect(
        decodeBase64Utf8(
          vi.mocked(composeContext.drafts.saveDraft).mock.lastCall?.[0].draft
            .body_html ?? ''
        )
      ).toContain('Restored reply edited before refresh');
      finish();
      await send;
      expect(onMarkDone).toHaveBeenCalledOnce();
    } finally {
      finish();
      state.dispose();
    }
  });

  it('does not add a scheduling notice after persistence already failed', async () => {
    const composeContext = createComposeContext();
    const failure = new Error('Draft save failed');
    vi.mocked(composeContext.drafts.saveDraft).mockRejectedValueOnce(failure);
    const state = mountReplyComposer(composeContext);
    try {
      expect(state.handleSendTimeChange(new Date('2026-12-01T12:00:00Z'))).toBe(
        true
      );
      await state.sendEmail();
      expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
      expect(
        composeContext.notices.feedback.failure
      ).toHaveBeenCalledExactlyOnceWith('Failed to save draft');
      expect(composeContext.notices.reportError).toHaveBeenCalledWith(failure);
    } finally {
      state.dispose();
    }
  });

  it('does not overwrite a newly edited reply when an older unmounted send fails', async () => {
    const composeContext = createComposeContext();
    const { promise: sending, reject } =
      Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(composeContext.delivery.sendMessage).mockReturnValueOnce(sending);
    const first = mountReplyComposer(composeContext);
    first.edit('Older reply');
    const send = first.sendEmail();
    await vi.advanceTimersByTimeAsync(0);
    first.dispose();
    const newer = mountReplyComposer(composeContext);
    try {
      newer.form.setSubject('New subject');
      newer.edit('Newer reply');
      reject(new Error('Offline'));
      await send;
      expect(newer.form.subject()).toBe('New subject');
      expect(decodeBase64Utf8(newer.collectDraft()?.body_html ?? '')).toContain(
        'Newer reply'
      );
    } finally {
      newer.dispose();
    }
  });
  it('completes reply mark-done when the post-send refresh fails', async () => {
    const composeContext = createComposeContext();
    const failure = new Error('Refresh failed');
    const onMarkDone = vi.fn();
    const state = mountReplyComposer(composeContext, undefined, {
      sideEffectOnSend: async () => {
        throw failure;
      },
      onMarkDone,
    });
    try {
      await state.sendEmail(true);
      expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(onMarkDone).toHaveBeenCalledOnce();
      expect(composeContext.notices.reportError).toHaveBeenCalledWith(failure);
      expect(composeContext.notices.feedback.failure).not.toHaveBeenCalled();
      expect(state.isSending()).toBe(false);
    } finally {
      state.dispose();
    }
  });

  it('restores a failed reply after optimistic reset without marking it done', async () => {
    const composeContext = createComposeContext();
    vi.mocked(composeContext.delivery.sendMessage).mockRejectedValueOnce(
      new Error('Offline')
    );
    const onMarkDone = vi.fn();
    const state = mountReplyComposer(composeContext, undefined, { onMarkDone });
    try {
      state.edit('Keep my reply');
      await state.sendEmail(true);
      expect(
        composeContext.notices.feedback.failure
      ).toHaveBeenCalledExactlyOnceWith('Failed to send email');
      expect(onMarkDone).not.toHaveBeenCalled();
      expect(state.savedDraftId()).toBe('draft');
      expect(decodeBase64Utf8(state.collectDraft()?.body_html ?? '')).toContain(
        'Keep my reply'
      );
      expect(state.isSending()).toBe(false);
    } finally {
      state.dispose();
    }
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serializes the last reply edit on disposal and reuses the ID from its first save', async () => {
    const { promise: saving, resolve: finish } =
      Promise.withResolvers<PersistedEmailIdentity>();
    const composeContext = createComposeContext();
    vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(saving);
    const state = mountReplyComposer(composeContext);
    state.edit('First version');
    await vi.advanceTimersByTimeAsync(500);
    state.edit('Final version');
    state.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
    finish({ draftId: 'saved-reply', threadId: 'thread', inboxId: 'inbox' });
    await vi.advanceTimersByTimeAsync(0);
    expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
    const latest = vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0]
      .draft;
    expect(latest.db_id).toBe('saved-reply');
    expect(latest.replying_to_id).toBe('parent');
    expect(decodeBase64Utf8(latest.body_html!)).toContain('Final version');
  });

  it('flushes an unmounted editor only to its original reply target', async () => {
    const [target, setTarget] = createSignal(message('original'));
    const composeContext = createComposeContext();
    const state = mountReplyComposer(composeContext, target);
    state.edit('Belongs to the original message');
    // Solid updates keyed parent props before disposing the previous child.
    setTarget(message('next'));
    state.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
    expect(
      vi.mocked(composeContext.drafts.saveDraft).mock.calls[0][0].draft
    ).toMatchObject({
      replying_to_id: 'original',
    });
  });

  it('waits for attachment persistence before scheduling and retains the selected inbox', async () => {
    const { promise: uploading, resolve: finish } =
      Promise.withResolvers<void>();
    const composeContext = createComposeContext();
    vi.mocked(
      composeContext.attachmentStorage.uploadAttachments
    ).mockReturnValueOnce(uploading);
    const state = mountReplyComposer(composeContext);
    try {
      state.form.setSelectedInbox('secondary');
      state.handleAddAttachments([new File(['attachment'], 'review.txt')]);
      await vi.advanceTimersByTimeAsync(500);
      expect(state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'))).toBe(
        true
      );
      const scheduling = state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
      finish();
      await scheduling;
      expect(composeContext.delivery.schedule).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftId: 'draft' }),
        'secondary'
      );
    } finally {
      state.dispose();
    }
  });

  it('discards an in-flight first reply save after an upload failure without leaving a draft', async () => {
    const { promise: uploading, reject: fail } = Promise.withResolvers<void>();
    const composeContext = createComposeContext();
    vi.mocked(
      composeContext.attachmentStorage.uploadAttachments
    ).mockReturnValueOnce(uploading);
    const state = mountReplyComposer(composeContext);
    try {
      state.handleAddAttachments([new File(['attachment'], 'review.txt')]);
      await vi.advanceTimersByTimeAsync(500);
      expect(state.savedDraftId()).toBe('draft');
      const discarded = state.deleteDraftAndReset();
      expect(composeContext.drafts.deleteDraft).not.toHaveBeenCalled();
      fail(new Error('Upload failed'));
      await discarded;
      await vi.advanceTimersByTimeAsync(1000);
      expect(composeContext.drafts.deleteDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftId: 'draft' })
      );
      expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(state.savedDraftId()).toBeUndefined();
    } finally {
      state.dispose();
    }
  });

  it.each(['send', 'discard'] as const)(
    'blocks scheduling and inbox changes during a pending reply %s',
    async (operation) => {
      const { promise: pending, resolve: finish } =
        Promise.withResolvers<void>();
      const composeContext = createComposeContext();
      if (operation === 'send')
        vi.mocked(composeContext.delivery.sendMessage).mockImplementationOnce(
          async () => {
            await pending;
            return { draftId: 'sent', threadId: 'thread', inboxId: 'inbox' };
          }
        );
      else
        vi.mocked(composeContext.drafts.deleteDraft).mockReturnValueOnce(
          pending
        );
      const state = mountReplyComposer(composeContext);
      try {
        state.edit('Ready');
        await vi.advanceTimersByTimeAsync(500);
        expect(state.sendActionDisabled()).toBe(false);
        const completing =
          operation === 'send'
            ? state.sendEmail()
            : state.deleteDraftAndReset();
        await vi.advanceTimersByTimeAsync(0);
        expect(state.sendActionDisabled()).toBe(true);
        const saves = vi.mocked(composeContext.drafts.saveDraft).mock.calls
          .length;
        await state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'));
        state.persistDraftOnSenderSwitch('secondary');
        await vi.advanceTimersByTimeAsync(500);
        expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
        expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(saves);
        expect(state.activeInboxId()).toBe('inbox');
        finish();
        await completing;
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.sendActionDisabled()).toBe(false);
        expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(saves);
      } finally {
        finish();
        state.dispose();
      }
    }
  );

  it('does not attach a forwarded file removed while the first draft save is pending', async () => {
    const { promise: saving, resolve: finish } =
      Promise.withResolvers<PersistedEmailIdentity>();
    const composeContext = createComposeContext();
    vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(saving);
    const state = mountReplyComposer(composeContext);
    try {
      const attachment = {
        type: 'forwarded' as const,
        attachmentId: 'file',
        fileName: 'review.txt',
        mimeType: 'text/plain',
        fileSize: 10,
      };
      state.form.attachments.add(attachment);
      state.edit('Forwarding');
      await vi.advanceTimersByTimeAsync(500);
      state.handleRemoveAttachment(attachment);
      expect(
        composeContext.attachmentStorage.removeForwardedAttachment
      ).not.toHaveBeenCalled();
      finish({ draftId: 'draft', threadId: 'thread', inboxId: 'inbox' });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        composeContext.attachmentStorage.addForwardedAttachments
      ).not.toHaveBeenCalled();
    } finally {
      state.dispose();
    }
  });

  it('persists forwarded references once per committed reply save', async () => {
    const context = createComposeContext();
    const state = mountReplyComposer(context);
    try {
      state.form.attachments.add({
        type: 'forwarded',
        attachmentId: 'source-file',
        fileName: 'review.txt',
        mimeType: 'text/plain',
        fileSize: 10,
      });
      state.edit('Forwarded content');
      await vi.advanceTimersByTimeAsync(600);
      expect(
        context.attachmentStorage.addForwardedAttachments
      ).toHaveBeenCalledExactlyOnceWith({
        draftId: 'draft',
        inboxId: 'inbox',
        attachments: [{ attachmentId: 'source-file' }],
      });
    } finally {
      state.dispose();
    }
  });

  it('waits for the first save, sends its returned draft ID once, and does not recreate the sent reply', async () => {
    const { promise: saving, resolve: finish } =
      Promise.withResolvers<PersistedEmailIdentity>();
    const composeContext = createComposeContext();
    vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(saving);
    const state = mountReplyComposer(composeContext);
    try {
      const sending = state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      await state.sendEmail();
      expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
      finish({ draftId: 'saved-reply', threadId: 'thread', inboxId: 'inbox' });
      await sending;
      expect(
        vi.mocked(composeContext.delivery.sendMessage).mock.calls[0][0].message
          .db_id
      ).toBe('saved-reply');
      state.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
    } finally {
      state.dispose();
    }
  });

  it.each([false, true])(
    'restores a cross-inbox reply and its envelope after undo (remount: %s)',
    async (remount) => {
      const composeContext = createComposeContext();
      const persisted = {
        draftId: 'cross-inbox-draft',
        threadId: 'secondary-thread',
        inboxId: 'secondary',
      };
      vi.mocked(composeContext.drafts.saveDraft).mockResolvedValue(persisted);
      vi.mocked(composeContext.delivery.sendMessage).mockResolvedValue(
        persisted
      );
      vi.mocked(composeContext.delivery.undoSend).mockImplementation(
        async ({ onUndone }) => {
          await onUndone();
        }
      );
      const target = () => message(`cross-inbox-${remount}`);
      let state = mountReplyComposer(composeContext, target);
      try {
        state.form.setSelectedInbox('secondary');
        state.form.setSubject('Custom reply subject');
        state.form.setRecipients('cc', [
          {
            kind: 'custom',
            id: 'reviewer@example.com',
            data: {
              id: 'reviewer@example.com',
              email: 'reviewer@example.com',
              invalid: false,
            },
          },
        ]);
        await state.sendEmail();
        await vi.advanceTimersByTimeAsync(0);
        expect(composeContext.delivery.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ inboxId: 'secondary' })
        );
        const notice = vi
          .mocked(composeContext.notices.feedback.success)
          .mock.calls.find(([text]) => text === 'Email sent');
        if (remount) state.dispose();
        notice?.[1]?.actions?.[0].onClick();
        await vi.advanceTimersByTimeAsync(0);
        expect(composeContext.drafts.restoreDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            inboxId: 'secondary',
            threadId: 'secondary-thread',
            draft: expect.objectContaining({
              thread_db_id: 'secondary-thread',
            }),
          })
        );
        if (remount) state = mountReplyComposer(composeContext, target);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.activeInboxId()).toBe('secondary');
        state.edit('Continued after undo');
        await vi.advanceTimersByTimeAsync(500);
        expect(composeContext.drafts.saveDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            inboxId: 'secondary',
            previousThreadId: 'secondary-thread',
            draft: expect.objectContaining({
              db_id: 'cross-inbox-draft',
              subject: 'Custom reply subject',
              cc: [expect.objectContaining({ email: 'reviewer@example.com' })],
            }),
          })
        );
        await state.deleteDraftAndReset();
        expect(composeContext.drafts.deleteDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            threadId: 'secondary-thread',
            inboxId: 'secondary',
          })
        );
      } finally {
        state.dispose();
      }
    }
  );

  it('reconciles each previous persisted thread when a reply moves between inboxes', async () => {
    const composeContext = createComposeContext();
    const { promise: saving, resolve: finish } =
      Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(composeContext.drafts.saveDraft)
      .mockResolvedValue({
        draftId: 'draft-c',
        threadId: 'thread-c',
        inboxId: 'c',
      })
      .mockReturnValueOnce(saving)
      .mockResolvedValueOnce({
        draftId: 'draft-b',
        threadId: 'thread-b',
        inboxId: 'b',
      })
      .mockResolvedValueOnce({
        draftId: 'draft-c',
        threadId: 'thread-c',
        inboxId: 'c',
      });
    const state = mountReplyComposer(composeContext);
    try {
      state.edit('Moving between inboxes');
      await vi.advanceTimersByTimeAsync(500);
      state.persistDraftOnSenderSwitch('b');
      finish({ draftId: 'draft-a', threadId: 'thread-a', inboxId: 'inbox' });
      await vi.advanceTimersByTimeAsync(0);
      state.persistDraftOnSenderSwitch('c');
      await vi.advanceTimersByTimeAsync(0);
      const inputs = vi
        .mocked(composeContext.drafts.saveDraft)
        .mock.calls.map(([input]) => input);
      expect(inputs.map((input) => input.previousThreadId)).toEqual([
        undefined,
        'thread-a',
        'thread-b',
      ]);
      expect(inputs.map((input) => input.draft.db_id)).toEqual([
        undefined,
        'draft-a',
        'draft-b',
      ]);
      state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'));
      await state.sendEmail();
      expect(composeContext.delivery.archive).toHaveBeenLastCalledWith(
        { threadId: 'thread-c', value: true },
        'c'
      );
    } finally {
      state.dispose();
    }
  });

  it.each(['standalone', 'reply'] as const)(
    '%s rejects a time change after immediate submission has started',
    async (kind) => {
      const { promise: saving, resolve: finishSaving } =
        Promise.withResolvers<PersistedEmailIdentity>();
      const composeContext = createComposeContext();
      vi.mocked(composeContext.drafts.saveDraft).mockImplementationOnce(
        () => saving
      );
      const state = composer(kind, composeContext);
      try {
        state.send();
        await vi.advanceTimersByTimeAsync(0);
        expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
        expect(state.selectTime(new Date('2026-10-01T12:00:00Z'))).toBe(false);
        finishSaving({
          draftId: 'draft',
          threadId: 'thread',
          inboxId: 'inbox',
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
        expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
      } finally {
        state.dispose();
      }
    }
  );
});
