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
  EmailComposeServices,
  SavedEmailDraft,
} from '../context/compose-services';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { composeServices } from '../tests/services';
import { createEmailComposer } from './email-composer';
import { createEmailFormState } from './email-form-state';
import { createReplyInput } from './reply-input';

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
  services: EmailComposeServices,
  replyingTo = () => message('parent')
) {
  return createRoot((dispose) => {
    const { editor, edit } = emailEditor();
    const parent = replyingTo();
    const form = createEmailFormState(
      { viewerEmail: services.viewerEmail, inboxes: services.accounts.inboxes },
      { type: 'replying_to', messageID: parent.db_id },
      { getMessageByID: () => parent, getDraftForMessageReply: () => undefined }
    );
    const state = createReplyInput(
      {
        services,
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
    state.editorOptions.onChange?.('Ready to send');
    return {
      ...state,
      dispose,
      edit(text: string) {
        edit(text);
        state.editorOptions.onChange?.(text);
      },
    };
  });
}

function composer(
  kind: 'standalone' | 'reply',
  services: EmailComposeServices
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
      services,
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
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serializes the last reply edit on disposal and reuses the ID from its first save', async () => {
    let finish!: (value: { draft: SavedEmailDraft }) => void;
    const services = composeServices();
    vi.mocked(services.saveDraft).mockReturnValueOnce(
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
    expect(services.saveDraft).toHaveBeenCalledOnce();
    finish({
      draft: { db_id: 'saved-reply', thread_db_id: 'thread', link_id: 'inbox' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.saveDraft).toHaveBeenCalledTimes(2);
    const latest = vi.mocked(services.saveDraft).mock.calls[1][0].draft;
    expect(latest.db_id).toBe('saved-reply');
    expect(latest.replying_to_id).toBe('parent');
    expect(decodeBase64Utf8(latest.body_html!)).toContain('Final version');
  });

  it('flushes an unmounted editor only to its original reply target', async () => {
    const [target, setTarget] = createSignal(message('original'));
    const services = composeServices();
    const state = replyComposer(services, target);
    state.edit('Belongs to the original message');
    // Solid updates keyed parent props before disposing the previous child.
    setTarget(message('next'));
    state.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(services.saveDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(services.saveDraft).mock.calls[0][0].draft).toMatchObject({
      replying_to_id: 'original',
    });
  });

  it('waits for attachment persistence before scheduling and retains the selected inbox', async () => {
    let finish!: () => void;
    const services = composeServices();
    vi.mocked(services.uploadAttachments).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      state.form().setSelectedFromLink('secondary');
      state.handleAddAttachments([new File(['attachment'], 'review.txt')]);
      await vi.advanceTimersByTimeAsync(500);
      const scheduling = state.handleSendTimeChange(
        new Date('2026-10-01T12:00:00Z')
      );
      await vi.advanceTimersByTimeAsync(0);
      state.form().setSelectedFromLink('inbox');
      expect(services.schedule).not.toHaveBeenCalled();
      finish();
      await scheduling;
      expect(services.schedule).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftID: 'draft' }),
        'secondary'
      );
    } finally {
      state.dispose();
    }
  });

  it('discards an in-flight first reply save after an upload failure without leaving a draft', async () => {
    let fail!: (error: Error) => void;
    const services = composeServices();
    vi.mocked(services.uploadAttachments).mockReturnValueOnce(
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
      expect(services.deleteDraft).not.toHaveBeenCalled();
      fail(new Error('Upload failed'));
      await discarded;
      await vi.advanceTimersByTimeAsync(1000);
      expect(services.deleteDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ draftId: 'draft' })
      );
      expect(services.saveDraft).toHaveBeenCalledOnce();
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
      const services = composeServices();
      if (operation === 'send')
        vi.mocked(services.sendMessage).mockImplementationOnce(async () => {
          await pending;
          return {
            message: {
              db_id: 'sent',
              thread_db_id: 'thread',
              link_id: 'inbox',
            },
          };
        });
      else vi.mocked(services.deleteDraft).mockReturnValueOnce(pending);
      const state = replyComposer(services);
      try {
        state.edit('Ready');
        await vi.advanceTimersByTimeAsync(500);
        const completing =
          operation === 'send'
            ? state.sendEmail()
            : state.deleteDraftAndReset();
        await vi.advanceTimersByTimeAsync(0);
        const saves = vi.mocked(services.saveDraft).mock.calls.length;
        await state.handleSendTimeChange(new Date('2026-10-01T12:00:00Z'));
        state.persistDraftOnSenderSwitch('secondary');
        await vi.advanceTimersByTimeAsync(500);
        expect(services.schedule).not.toHaveBeenCalled();
        expect(services.saveDraft).toHaveBeenCalledTimes(saves);
        expect(state.activeLinkId()).toBe('inbox');
        finish();
        await completing;
        await vi.advanceTimersByTimeAsync(1000);
        expect(services.saveDraft).toHaveBeenCalledTimes(saves);
      } finally {
        finish();
        state.dispose();
      }
    }
  );

  it('does not attach a forwarded file removed while the first draft save is pending', async () => {
    let finish!: (value: { draft: SavedEmailDraft }) => void;
    const services = composeServices();
    vi.mocked(services.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      const attachment = {
        type: 'forwarded' as const,
        attachmentID: 'file',
        fileName: 'review.txt',
        mimeType: 'text/plain',
        fileSize: 10,
      };
      state.form().attachments.add(attachment);
      state.edit('Forwarding');
      await vi.advanceTimersByTimeAsync(500);
      state.handleRemoveAttachment(attachment);
      finish({
        draft: { db_id: 'draft', thread_db_id: 'thread', link_id: 'inbox' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(services.addForwardedAttachments).not.toHaveBeenCalled();
    } finally {
      state.dispose();
    }
  });

  it('does not submit a second reply while its first send is still saving', async () => {
    let finish!: (value: { draft: SavedEmailDraft }) => void;
    const services = composeServices();
    vi.mocked(services.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const state = replyComposer(services);
    try {
      const sending = state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      await state.sendEmail();
      expect(services.saveDraft).toHaveBeenCalledOnce();
      finish({
        draft: {
          db_id: 'saved-reply',
          thread_db_id: 'thread',
          link_id: 'inbox',
        },
      });
      await sending;
      await vi.advanceTimersByTimeAsync(1000);
      expect(services.sendMessage).toHaveBeenCalledOnce();
      expect(services.saveDraft).toHaveBeenCalledOnce();
    } finally {
      state.dispose();
    }
  });

  it.each([false, true])(
    'restores a cross-inbox reply and its envelope after undo (remount: %s)',
    async (remount) => {
      const services = composeServices();
      const persisted = {
        db_id: 'cross-inbox-draft',
        thread_db_id: 'secondary-thread',
        link_id: 'secondary',
      };
      vi.mocked(services.saveDraft).mockResolvedValue({ draft: persisted });
      vi.mocked(services.sendMessage).mockResolvedValue({ message: persisted });
      vi.mocked(services.undoSend).mockImplementation(async ({ onUndone }) => {
        await onUndone();
      });
      const target = () => message(`cross-inbox-${remount}`);
      let state = replyComposer(services, target);
      try {
        state.form().setSelectedFromLink('secondary');
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
        expect(services.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ linkId: 'secondary' })
        );
        const notice = vi
          .mocked(services.feedback.success)
          .mock.calls.find(([text]) => text === 'Email sent');
        if (remount) state.dispose();
        notice?.[1]?.actions?.[0].onClick();
        await vi.advanceTimersByTimeAsync(0);
        expect(services.restoreDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            linkId: 'secondary',
            threadId: 'secondary-thread',
            draft: expect.objectContaining({
              thread_db_id: 'secondary-thread',
            }),
          })
        );
        if (remount) state = replyComposer(services, target);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.activeLinkId()).toBe('secondary');
        state.edit('Continued after undo');
        await vi.advanceTimersByTimeAsync(500);
        expect(services.saveDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            linkId: 'secondary',
            previousThreadId: 'secondary-thread',
            draft: expect.objectContaining({
              db_id: 'cross-inbox-draft',
              subject: 'Custom reply subject',
              cc: [expect.objectContaining({ email: 'reviewer@example.com' })],
            }),
          })
        );
        await state.deleteDraftAndReset();
        expect(services.deleteDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            threadId: 'secondary-thread',
            linkId: 'secondary',
          })
        );
      } finally {
        state.dispose();
      }
    }
  );

  it('reconciles each previous persisted thread when a reply moves between inboxes', async () => {
    const services = composeServices();
    let finish!: (value: { draft: SavedEmailDraft }) => void;
    vi.mocked(services.saveDraft)
      .mockResolvedValue({
        draft: { db_id: 'draft-c', thread_db_id: 'thread-c', link_id: 'c' },
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValueOnce({
        draft: { db_id: 'draft-b', thread_db_id: 'thread-b', link_id: 'b' },
      })
      .mockResolvedValueOnce({
        draft: { db_id: 'draft-c', thread_db_id: 'thread-c', link_id: 'c' },
      });
    const state = replyComposer(services);
    try {
      state.edit('Moving between inboxes');
      await vi.advanceTimersByTimeAsync(500);
      state.persistDraftOnSenderSwitch('b');
      state.persistDraftOnSenderSwitch('c');
      finish({
        draft: { db_id: 'draft-a', thread_db_id: 'thread-a', link_id: 'inbox' },
      });
      await vi.advanceTimersByTimeAsync(0);
      const inputs = vi
        .mocked(services.saveDraft)
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
      expect(services.archive).toHaveBeenLastCalledWith(
        { id: 'thread-c', value: true },
        'c'
      );
    } finally {
      state.dispose();
    }
  });

  it('waits for a saved reply and dispatches with its returned draft ID', async () => {
    let finishSaving!: (value: { draft: SavedEmailDraft }) => void;
    const services = composeServices();
    vi.mocked(services.saveDraft).mockReturnValueOnce(
      new Promise((resolve) => {
        finishSaving = resolve;
      })
    );
    const state = composer('reply', services);
    try {
      state.send();
      await vi.advanceTimersByTimeAsync(0);
      expect(services.saveDraft).toHaveBeenCalledOnce();
      expect(services.sendMessage).not.toHaveBeenCalled();
      finishSaving({
        draft: {
          db_id: 'saved-reply',
          thread_db_id: 'thread',
          link_id: 'inbox',
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(services.sendMessage).toHaveBeenCalledOnce();
      expect(
        vi.mocked(services.sendMessage).mock.calls[0][0].message.db_id
      ).toBe('saved-reply');
    } finally {
      state.dispose();
    }
  });

  it.each(['standalone', 'reply'] as const)(
    '%s does not dispatch when scheduling starts during the pending draft save',
    async (kind) => {
      let finishSaving!: (value: { draft: SavedEmailDraft }) => void;
      let finishScheduling!: () => void;
      const services = composeServices({
        schedule: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishScheduling = resolve;
            })
        ),
      });
      vi.mocked(services.saveDraft).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSaving = resolve;
          })
      );
      const state = composer(kind, services);
      try {
        state.send();
        await vi.advanceTimersByTimeAsync(0);
        expect(services.saveDraft).toHaveBeenCalledOnce();
        const scheduling = state.schedule(new Date('2026-10-01T12:00:00Z'));
        await vi.advanceTimersByTimeAsync(0);
        finishSaving({
          draft: { db_id: 'draft', thread_db_id: 'thread', link_id: 'inbox' },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(services.sendMessage).not.toHaveBeenCalled();
        expect(services.schedule).toHaveBeenCalledOnce();
        finishScheduling();
        await scheduling;
      } finally {
        state.dispose();
      }
    }
  );
});
