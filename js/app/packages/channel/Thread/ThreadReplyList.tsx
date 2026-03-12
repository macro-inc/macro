import { For, createMemo } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotifications';
import { buildThreadReplyListMeta } from './reply-list-meta';
import type { MessageEditor } from '../Channel/create-message-editor';

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
}) {
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies)
  );

  return (
    <For each={props.replies}>
      {(reply) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        return (
          <MarkMessaageNotifications
            messageId={reply.id}
            channelId={props.channelId}
          >
            <ChannelMessage
              channelId={props.channelId}
              message={reply}
              actions={props.getMessageActions?.(replyMessage())}
              listMeta={listMetaByReplyId()[reply.id]}
              messageEditor={props.messageEditor}
            />
          </MarkMessaageNotifications>
        );
      }}
    </For>
  );
}
