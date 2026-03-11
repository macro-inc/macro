import { For } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { InlineMessageEditor } from '../Channel/InlineMessageEditor';
import type { InputSnapshot } from '../Input';
import type { MessageEditState } from './types';

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  editState?: MessageEditState;
  onEditChange?: (message: MessageData, snapshot: InputSnapshot) => void;
  onEditCancel?: (messageId: string) => void;
  onEditSave?: (message: MessageData, snapshot: InputSnapshot) => void;
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
            {props.editState?.messageId === reply.id ? (
              <InlineMessageEditor
                channelId={props.channelId}
                message={reply}
                snapshot={props.editState.snapshot}
                onChange={(snapshot) =>
                  props.onEditChange?.(replyMessage(), snapshot)
                }
                onCancel={() => props.onEditCancel?.(reply.id)}
                onSave={(snapshot) =>
                  props.onEditSave?.(replyMessage(), snapshot)
                }
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
