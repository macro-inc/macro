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

describe.each(['standalone', 'reply'] as const)(
  '%s send and schedule ordering',
  (kind) => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sends a valid message after the draft is saved', async () => {
      const services = composeServices();
      const state = composer(kind, services);
      try {
        state.send();
        await vi.advanceTimersByTimeAsync(0);
        expect(services.saveDraft).toHaveBeenCalledOnce();
        expect(services.sendMessage).toHaveBeenCalledOnce();
      } finally {
        state.dispose();
      }
    });

    it('does not dispatch when scheduling starts during the pending draft save', async () => {
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
    });
  }
);
