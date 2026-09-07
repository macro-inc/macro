import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type {
  EmailComposeServices,
  SavedEmailDraft,
} from '../context/compose-services';
import { composeServices } from '../tests/services';
import { createEmailComposer } from './email-composer';
import { createEmailFormState } from './email-form-state';
import { createReplyInput } from './reply-input';

function composer(
  kind: 'standalone' | 'reply',
  services: EmailComposeServices
) {
  return createRoot((dispose) => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Ready to send'))
        );
      },
      { discrete: true }
    );
    if (kind === 'standalone') {
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
    }
    const parent = message('parent');
    const form = createEmailFormState(
      { viewerEmail: services.viewerEmail, inboxes: services.accounts.inboxes },
      { type: 'replying_to', messageID: parent.db_id },
      { getMessageByID: () => parent, getDraftForMessageReply: () => undefined }
    );
    const state = createReplyInput(
      {
        services,
        sourceEntityId: 'thread',
        replyingTo: () => parent,
        session: {
          thread: () => ({
            db_id: 'thread',
            link_id: 'inbox',
            inbox_visible: false,
          }),
          recipientOptions: () => [],
          onRecipientsChange() {},
          drafts: {
            getDraftForMessage: () => undefined,
            deleteDraftForMessage() {},
          },
          messages: {
            list: () => [parent],
            unfiltered: () => [parent],
            personalSenders: () => new Set(),
            focusedID: () => parent.db_id,
            setFocused() {},
          },
          replyRequest: {
            messageId: () => undefined,
            replyType: () => undefined,
            clear() {},
          },
          getMarkDoneNavigationTargetId: () => undefined,
        },
      },
      () => editor,
      { container: () => undefined, footer: () => undefined },
      () => form
    );
    return {
      dispose,
      send: () => state.sendEmail(),
      schedule: state.handleSendTimeChange,
    };
  });
}

describe('send and schedule ordering', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
