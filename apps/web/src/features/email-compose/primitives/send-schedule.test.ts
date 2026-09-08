import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type {
  EmailComposeEnvironment,
  PersistedEmailIdentity,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { composeEnvironment } from '../tests/capabilities';
import { createEmailComposer } from './email-composer';
import { createEmailFormState } from './email-form-state';
import {
  createReplyComposer,
  type ReplyComposerOptions,
} from './reply-composer';

function emailEditor() {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  const edit = (text: string) =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode(text)));
      },
      { discrete: true }
    );
  edit('Ready to send');
  return { editor, edit };
}

function replyComposer(
  services: EmailComposeEnvironment,
  replyingTo = () => message('parent'),
  callbacks: Pick<ReplyComposerOptions, 'sideEffectOnSend' | 'onMarkDone'> = {}
) {
  return createRoot((dispose) => {
    const { editor, edit } = emailEditor();
    const parent = replyingTo();
    const form = createEmailFormState(
      { viewerEmail: services.viewerEmail, inboxes: services.accounts.inboxes },
      { type: 'replying_to', messageId: parent.db_id },
      { getMessageById: () => parent, getDraftForMessageReply: () => undefined }
    );
    const state = createReplyComposer(
      {
        ...callbacks,
        ...services,
        focusAfterReplyRequest: () => true,
        sourceEntityId: 'thread',
        replyingTo,
        session: {
          thread: () => ({
            db_id: 'thread',
            link_id: 'inbox',
            inbox_visible: false,
          }),
          recipientOptions: () => [],
          isPersonalReply: () => false,
          onDraftRemoved() {},
          exitToThread: () => false,
          replyRequest: { replyType: () => undefined, clear() {} },
          getMarkDoneNavigationTargetId: () => undefined,
        },
      },
      () => editor,
      { container: () => undefined, footer: () => undefined },
      () => form
    );
    state.onContentChange('Ready to send');
    return {
      ...state,
      dispose,
      edit(text: string) {
        edit(text);
        state.onContentChange(text);
      },
    };
  });
}

function composer(
  kind: 'standalone' | 'reply',
  services: EmailComposeEnvironment
) {
  if (kind === 'reply') {
    const state = replyComposer(services);
    return {
      dispose: state.dispose,
      send: () => state.sendEmail(),
      schedule: state.handleSendTimeChange,
    };
  }
  return createRoot((dispose) => {
    const { editor } = emailEditor();
    const { context } = createEmailComposer({
      ...services,
      initialTo: ['colleague@example.com'],
    });
    context.captureEditor(editor);
    context.setSubject('Review');
    context.onContentChange('Ready to send');
    return {
      dispose,
      send: context.onSend,
      schedule: context.onSendTimeChange!,
    };
  });
}

describe('send and schedule ordering', () => {
  it('undoes mark-done while the post-send refresh is still pending', async () => {
    const services = composeEnvironment();
    let finish!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const undo = vi.fn(async () => {});
    const onMarkDone = vi.fn((options) =>
      options.onUndoHandle({ id: 'done', undo, dispose() {} })
    );
    vi.mocked(services.delivery.undoSend).mockImplementation(
      async ({ onUndone }) => {
        await onUndone();
      }
    );
    const state = replyComposer(services, undefined, {
      sideEffectOnSend: () => refresh,
      onMarkDone,
    });
    try {
      const send = state.sendEmail(true);
      await vi.advanceTimersByTimeAsync(0);
      const sentNotice = vi
        .mocked(services.notices.feedback.success)
        .mock.calls.find(([text]) => text === 'Email sent');
      expect(onMarkDone).toHaveBeenCalledOnce();
      sentNotice?.[1]?.actions?.[0].onClick();
      await vi.advanceTimersByTimeAsync(0);
      expect(undo).toHaveBeenCalledOnce();
      expect(state.isSending()).toBe(false);
      state.edit('Restored reply edited before refresh');
      await vi.advanceTimersByTimeAsync(600);
      expect(
        decodeBase64Utf8(
          vi.mocked(services.drafts.saveDraft).mock.lastCall?.[0].draft
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
    const services = composeEnvironment();
    const failure = new Error('Draft save failed');
    vi.mocked(services.drafts.saveDraft).mockImplementationOnce(async () => {
      services.notices.feedback.failure('Failed to save draft');
      throw failure;
    });
    const state = replyComposer(services);
    try {
      await state.handleSendTimeChange(new Date('2026-12-01T12:00:00Z'));
      expect(services.delivery.schedule).not.toHaveBeenCalled();
      expect(services.notices.feedback.failure).toHaveBeenCalledExactlyOnceWith(
        'Failed to save draft'
      );
      expect(services.notices.reportError).toHaveBeenCalledWith(failure);
    } finally {
      state.dispose();
    }
  });

  it('does not overwrite a newly edited reply when an older unmounted send fails', async () => {
    const services = composeEnvironment();
    let reject!: (error: Error) => void;
    vi.mocked(services.delivery.sendMessage).mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    const first = replyComposer(services);
    first.edit('Older reply');
    const send = first.sendEmail();
    await vi.advanceTimersByTimeAsync(0);
    first.dispose();
    const newer = replyComposer(services);
    try {
      newer.form().setSubject('New subject');
      newer.edit('Newer reply');
      reject(new Error('Offline'));
      await send;
      expect(newer.form().subject()).toBe('New subject');
      expect(decodeBase64Utf8(newer.collectDraft()?.body_html ?? '')).toContain(
        'Newer reply'
      );
    } finally {
      newer.dispose();
    }
  });
  it('completes reply mark-done when the post-send refresh fails', async () => {
    const services = composeEnvironment();
    const failure = new Error('Refresh failed');
    const onMarkDone = vi.fn();
    const state = replyComposer(services, undefined, {
      sideEffectOnSend: async () => {
        throw failure;
      },
      onMarkDone,
    });
    try {
      await state.sendEmail(true);
      expect(services.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(onMarkDone).toHaveBeenCalledOnce();
      expect(services.notices.reportError).toHaveBeenCalledWith(failure);
      expect(services.notices.feedback.failure).not.toHaveBeenCalled();
      expect(state.isSending()).toBe(false);
    } finally {
      state.dispose();
    }
  });

  it('restores a failed reply after optimistic reset without marking it done', async () => {
    const services = composeEnvironment();
    vi.mocked(services.delivery.sendMessage).mockRejectedValueOnce(
      new Error('Offline')
    );
    const onMarkDone = vi.fn();
    const state = replyComposer(services, undefined, { onMarkDone });
    try {
      state.edit('Keep my reply');
      await state.sendEmail(true);
      expect(services.notices.feedback.failure).toHaveBeenCalledExactlyOnceWith(
        'Failed to send email'
      );
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
    let finish!: (value: PersistedEmailIdentity) => void;
    const services = composeEnvironment();
    vi.mocked(services.drafts.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    state.edit('First version');
    await vi.advanceTimersByTimeAsync(500);
    state.edit('Final version');
    state.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
    finish({ draftId: 'saved-reply', threadId: 'thread', inboxId: 'inbox' });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.drafts.saveDraft).toHaveBeenCalledTimes(2);
    const latest = vi.mocked(services.drafts.saveDraft).mock.calls[1][0].draft;
    expect(latest.db_id).toBe('saved-reply');
    expect(latest.replying_to_id).toBe('parent');
    expect(decodeBase64Utf8(latest.body_html!)).toContain('Final version');
  });

  it('flushes an unmounted editor only to its original reply target', async () => {
    const [target, setTarget] = createSignal(message('original'));
    const services = composeEnvironment();
    const state = replyComposer(services, target);
    state.edit('Belongs to the original message');
    // Solid updates keyed parent props before disposing the previous child.
    setTarget(message('next'));
    state.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
    expect(
      vi.mocked(services.drafts.saveDraft).mock.calls[0][0].draft
    ).toMatchObject({
      replying_to_id: 'original',
    });
  });

  it('waits for attachment persistence before scheduling and retains the selected inbox', async () => {
    let finish!: () => void;
    const services = composeEnvironment();
    vi.mocked(services.attachmentStorage.uploadAttachments).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      state.form().setSelectedInbox('secondary');
      state.handleAddAttachments([new File(['attachment'], 'review.txt')]);
      await vi.advanceTimersByTimeAsync(500);
      const scheduling = state.handleSendTimeChange(
        new Date('2026-10-01T12:00:00Z')
      );
      await vi.advanceTimersByTimeAsync(0);
      state.form().setSelectedInbox('inbox');
      expect(services.delivery.schedule).not.toHaveBeenCalled();
      finish();
      await scheduling;
      expect(services.delivery.schedule).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftId: 'draft' }),
        'secondary'
      );
    } finally {
      state.dispose();
    }
  });

  it('discards an in-flight first reply save after an upload failure without leaving a draft', async () => {
    let fail!: (error: Error) => void;
    const services = composeEnvironment();
    vi.mocked(services.attachmentStorage.uploadAttachments).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      })
    );
    const state = replyComposer(services);
    try {
      state.handleAddAttachments([new File(['attachment'], 'review.txt')]);
      await vi.advanceTimersByTimeAsync(500);
      expect(state.savedDraftId()).toBe('draft');
      const discarded = state.deleteDraftAndReset();
      expect(services.drafts.deleteDraft).not.toHaveBeenCalled();
      fail(new Error('Upload failed'));
      await discarded;
      await vi.advanceTimersByTimeAsync(1000);
      expect(services.drafts.deleteDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftId: 'draft' })
      );
      expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(state.savedDraftId()).toBeUndefined();
    } finally {
      state.dispose();
    }
  });

  it.each(['send', 'discard'] as const)(
    'blocks scheduling and inbox changes during a pending reply %s',
    async (operation) => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const services = composeEnvironment();
      if (operation === 'send')
        vi.mocked(services.delivery.sendMessage).mockImplementationOnce(
          async () => {
            await pending;
            return { draftId: 'sent', threadId: 'thread', inboxId: 'inbox' };
          }
        );
      else vi.mocked(services.drafts.deleteDraft).mockReturnValueOnce(pending);
      const state = replyComposer(services);
      try {
        state.edit('Ready');
        await vi.advanceTimersByTimeAsync(500);
        const completing =
          operation === 'send'
            ? state.sendEmail()
            : state.deleteDraftAndReset();
        await vi.advanceTimersByTimeAsync(0);
        const saves = vi.mocked(services.drafts.saveDraft).mock.calls.length;
        await state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'));
        state.persistDraftOnSenderSwitch('secondary');
        await vi.advanceTimersByTimeAsync(500);
        expect(services.delivery.schedule).not.toHaveBeenCalled();
        expect(services.drafts.saveDraft).toHaveBeenCalledTimes(saves);
        expect(state.activeInboxId()).toBe('inbox');
        finish();
        await completing;
        await vi.advanceTimersByTimeAsync(1000);
        expect(services.drafts.saveDraft).toHaveBeenCalledTimes(saves);
      } finally {
        finish();
        state.dispose();
      }
    }
  );

  it('does not attach a forwarded file removed while the first draft save is pending', async () => {
    let finish!: (value: PersistedEmailIdentity) => void;
    const services = composeEnvironment();
    vi.mocked(services.drafts.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      const attachment = {
        type: 'forwarded' as const,
        attachmentId: 'file',
        fileName: 'review.txt',
        mimeType: 'text/plain',
        fileSize: 10,
      };
      state.form().attachments.add(attachment);
      state.edit('Forwarding');
      await vi.advanceTimersByTimeAsync(500);
      state.handleRemoveAttachment(attachment);
      finish({ draftId: 'draft', threadId: 'thread', inboxId: 'inbox' });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        services.attachmentStorage.addForwardedAttachments
      ).not.toHaveBeenCalled();
    } finally {
      state.dispose();
    }
  });

  it('does not submit a second reply while its first send is still saving', async () => {
    let finish!: (value: PersistedEmailIdentity) => void;
    const services = composeEnvironment();
    vi.mocked(services.drafts.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      const sending = state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      await state.sendEmail();
      expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
      finish({ draftId: 'saved-reply', threadId: 'thread', inboxId: 'inbox' });
      await sending;
      await vi.advanceTimersByTimeAsync(1000);
      expect(services.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
    } finally {
      state.dispose();
    }
  });

  it.each([false, true])(
    'restores a cross-inbox reply and its envelope after undo (remount: %s)',
    async (remount) => {
      const services = composeEnvironment();
      const persisted = {
        draftId: 'cross-inbox-draft',
        threadId: 'secondary-thread',
        inboxId: 'secondary',
      };
      vi.mocked(services.drafts.saveDraft).mockResolvedValue(persisted);
      vi.mocked(services.delivery.sendMessage).mockResolvedValue(persisted);
      vi.mocked(services.delivery.undoSend).mockImplementation(
        async ({ onUndone }) => {
          await onUndone();
        }
      );
      const target = () => message(`cross-inbox-${remount}`);
      let state = replyComposer(services, target);
      try {
        state.form().setSelectedInbox('secondary');
        state.form().setSubject('Custom reply subject');
        state.form().setRecipients('cc', [
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
        expect(services.delivery.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ inboxId: 'secondary' })
        );
        const notice = vi
          .mocked(services.notices.feedback.success)
          .mock.calls.find(([text]) => text === 'Email sent');
        if (remount) state.dispose();
        notice?.[1]?.actions?.[0].onClick();
        await vi.advanceTimersByTimeAsync(0);
        expect(services.drafts.restoreDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            inboxId: 'secondary',
            threadId: 'secondary-thread',
            draft: expect.objectContaining({
              thread_db_id: 'secondary-thread',
            }),
          })
        );
        if (remount) state = replyComposer(services, target);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.activeInboxId()).toBe('secondary');
        state.edit('Continued after undo');
        await vi.advanceTimersByTimeAsync(500);
        expect(services.drafts.saveDraft).toHaveBeenLastCalledWith(
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
        expect(services.drafts.deleteDraft).toHaveBeenLastCalledWith(
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
    const services = composeEnvironment();
    let finish!: (value: PersistedEmailIdentity) => void;
    vi.mocked(services.drafts.saveDraft)
      .mockResolvedValue({
        draftId: 'draft-c',
        threadId: 'thread-c',
        inboxId: 'c',
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
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
    const state = replyComposer(services);
    try {
      state.edit('Moving between inboxes');
      await vi.advanceTimersByTimeAsync(500);
      state.persistDraftOnSenderSwitch('b');
      state.persistDraftOnSenderSwitch('c');
      finish({ draftId: 'draft-a', threadId: 'thread-a', inboxId: 'inbox' });
      await vi.advanceTimersByTimeAsync(0);
      const inputs = vi
        .mocked(services.drafts.saveDraft)
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
      await state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'));
      expect(services.delivery.archive).toHaveBeenLastCalledWith(
        { threadId: 'thread-c', value: true },
        'c'
      );
    } finally {
      state.dispose();
    }
  });

  it('waits for a saved reply and dispatches with its returned draft ID', async () => {
    let finishSaving!: (value: PersistedEmailIdentity) => void;
    const services = composeEnvironment();
    vi.mocked(services.drafts.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finishSaving = resolve;
      })
    );
    const state = composer('reply', services);
    try {
      state.send();
      await vi.advanceTimersByTimeAsync(0);
      expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(services.delivery.sendMessage).not.toHaveBeenCalled();
      finishSaving({
        draftId: 'saved-reply',
        threadId: 'thread',
        inboxId: 'inbox',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(services.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(
        vi.mocked(services.delivery.sendMessage).mock.calls[0][0].message.db_id
      ).toBe('saved-reply');
    } finally {
      state.dispose();
    }
  });

  it.each(['standalone', 'reply'] as const)(
    '%s does not dispatch when scheduling starts during the pending draft save',
    async (kind) => {
      let finishSaving!: (value: PersistedEmailIdentity) => void;
      let finishScheduling!: () => void;
      const services = composeEnvironment({
        delivery: {
          schedule: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finishScheduling = resolve;
              })
          ),
        },
      });
      vi.mocked(services.drafts.saveDraft).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSaving = resolve;
          })
      );
      const state = composer(kind, services);
      try {
        state.send();
        await vi.advanceTimersByTimeAsync(0);
        expect(services.drafts.saveDraft).toHaveBeenCalledOnce();
        const scheduling = state.schedule(new Date('2026-10-01T12:00:00Z'));
        await vi.advanceTimersByTimeAsync(0);
        finishSaving({
          draftId: 'draft',
          threadId: 'thread',
          inboxId: 'inbox',
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(services.delivery.sendMessage).not.toHaveBeenCalled();
        expect(services.delivery.schedule).toHaveBeenCalledOnce();
        finishScheduling();
        await scheduling;
      } finally {
        state.dispose();
      }
    }
  );
});
