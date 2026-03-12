import { For } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { InlineMessageEditor } from '../Channel/InlineMessageEditor';
import type { MessageEditor } from '../Channel/create-message-editor';

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
}) {
  return (
    <For each={props.replies}>
      {(reply) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        return (
          <>
            {props.messageEditor?.state()?.messageId === reply.id ? (
              <InlineMessageEditor
                channelId={props.channelId}
                message={reply}
                snapshot={props.messageEditor.state()!.snapshot}
                messageEditor={props.messageEditor}
              />
            ) : (
              <ChannelMessage
                message={reply}
                actions={props.getMessageActions?.(replyMessage())}
              />
            )}
          </>
        );
      }}
    </For>
  );
}
