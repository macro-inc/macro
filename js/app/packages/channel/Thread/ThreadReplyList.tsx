import { For, createMemo } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotifications';
import { buildThreadReplyListMeta } from './reply-list-meta';
import { ThreadRail } from './ThreadRail';
import type { MessageEditor } from '../Channel/create-message-editor';
import type { NewMessageCheckable } from '../Channel/util';

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
  isNewMessage?: (message: NewMessageCheckable) => boolean;
}) {
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies, props.isNewMessage)
  );

  return (
    <For each={props.replies}>
      {(reply) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        return (
          <div class="relative">
            <ThreadRail
              newMessage={listMetaByReplyId()[reply.id].isNewMessage}
            />
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
          </div>
        );
      }}
    </For>
  );
}
