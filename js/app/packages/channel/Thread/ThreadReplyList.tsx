import { For, createMemo } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotifications';
import { buildThreadReplyListMeta } from './reply-list-meta';

export function ThreadReplyList(props: {
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  channelId: string;
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
              message={reply}
              actions={props.getMessageActions?.(replyMessage())}
              listMeta={listMetaByReplyId()[reply.id]}
            />
          </MarkMessaageNotifications>
        );
      }}
    </For>
  );
}
