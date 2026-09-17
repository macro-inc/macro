import { createMemo, createRoot } from 'solid-js';
import { message } from '../../email-message/tests/messages';
import type { EmailComposeContext } from '../context/compose-capabilities';
import { createEmailFormState } from '../primitives/email-form-state';
import {
  createReplyComposer,
  type ReplyComposerOptions,
} from '../primitives/reply-composer';
import { createEmailEditor, setEmailEditorText } from './editor';

/** A reply composer on a real editor, addressed to a thread of one message. */
export function mountReplyComposer(
  composeContext: EmailComposeContext,
  replyingTo = () => message('parent'),
  callbacks: Pick<ReplyComposerOptions, 'sideEffectOnSend' | 'onMarkDone'> = {}
) {
  return createRoot((dispose) => {
    const editor = createEmailEditor('Ready to send');
    const parent = replyingTo();
    const form = createEmailFormState(
      {
        viewerEmail: composeContext.viewerEmail,
        inboxes: composeContext.accounts.inboxes,
      },
      { type: 'replying_to', messageId: parent.db_id },
      { getMessageById: () => parent, getDraftForMessageReply: () => undefined }
    );
    const state = createReplyComposer(
      {
        ...callbacks,
        ...composeContext,
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
      sendActionDisabled: createMemo(state.sendActionDisabled),
      dispose,
      edit(text: string) {
        setEmailEditorText(editor, text);
        state.onContentChange(text);
      },
    };
  });
}
