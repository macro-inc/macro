import { EmailFormContextProvider } from '@app/features/email-compose/context/email-form-context';
import { ContentLoading } from '@components/app/ContentLoading';
import { Show } from 'solid-js';
import type { ReplyType } from '../../email-compose/core/reply-type';
import {
  type EmailRenderingContextValue,
  EmailRenderingProvider,
} from '../../email-message/context/email-rendering-context';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import {
  type EmailReplyHandoff,
  type EmailThreadViewContext,
  EmailThreadViewProvider,
} from '../context/email-thread-view-context';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { ThreadReplyInput } from './thread-reply-input';

/**
 * One reply of a thread without the thread around it, as the app's reply
 * window shows it. It loads the reply from its saved draft, like a thread
 * reopened after navigating away.
 */
export function EmailThreadReplySurface(props: {
  context: EmailThreadViewContext;
  emailRendering: EmailRenderingContextValue;
  reply: EmailReplyHandoff;
  /** The reply is saved; hand it back to its thread. */
  onGiveBack: (replyType: ReplyType) => void;
  /** The reply was sent or discarded. */
  onFinished: () => void;
  registerMove: (move: () => Promise<void>) => () => void;
}) {
  const state = createEmailThreadState(props.context.thread);
  // Lands the reply type and the cursor once the composer mounts.
  state.replyRequest.set(props.reply.messageId, props.reply.replyType);
  const message = () =>
    state.messages
      .unfiltered()
      .find((candidate) => candidate.db_id === props.reply.messageId);

  return (
    <EmailThreadViewProvider value={props.context}>
      <EmailRenderingProvider value={props.emailRendering}>
        <EmailThreadStateProvider value={state}>
          <EmailFormContextProvider
            context={{
              viewerEmail: props.context.compose.viewerEmail,
              inboxes: props.context.compose.accounts.inboxes,
            }}
            formOptions={{
              getMessageById: (id) =>
                state.messages.unfiltered().find((m) => m.db_id === id),
              getDraftForMessageReply: state.drafts.getDraftForMessage,
              onRecipientsChange: state.onRecipientsChange,
            }}
          >
            <Show when={message()} fallback={<ContentLoading />}>
              {(replyingTo) => (
                <ThreadReplyInput
                  replyingTo={replyingTo}
                  draft={state.drafts.getDraftForMessage(props.reply.messageId)}
                  setShowReply={(value) => {
                    const show =
                      typeof value === 'function' ? value(true) : value;
                    if (!show) props.onFinished();
                    return show;
                  }}
                  unframed
                  popout={{
                    inWindow: true,
                    move: props.onGiveBack,
                    registerMove: props.registerMove,
                  }}
                />
              )}
            </Show>
          </EmailFormContextProvider>
        </EmailThreadStateProvider>
      </EmailRenderingProvider>
    </EmailThreadViewProvider>
  );
}
