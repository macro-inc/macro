import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import type { ApiThreadReply } from '@service-comms/client';
import { type Accessor, createMemo, For, onMount } from 'solid-js';
import type { MessageEditor } from '../Channel/create-message-editor';
import type { NewMessageCheckable } from '../Channel/util';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import { buildThreadReplyListMeta } from './reply-list-meta';
import { ThreadRail } from './ThreadRail';

export type ThreadReplyListHandle = {
  scrollToIndex: (index: number) => boolean;
};

function getReplyElementAtIndex(
  elements: Array<HTMLElement | undefined>,
  index: number
): HTMLElement | undefined {
  if (index < 0) return undefined;
  return elements[index];
}

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
  isNewMessage?: (message: NewMessageCheckable) => boolean;
  onReady?: (handle: ThreadReplyListHandle) => void;
  selectedReplyId?: Accessor<string | undefined>;
  isThreadFocused?: Accessor<boolean>;
  onSelectReply?: (replyId: string) => void;
}) {
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies, props.isNewMessage)
  );
  const replyElements: Array<HTMLElement | undefined> = [];

  const scrollToIndex = (index: number): boolean => {
    const element = getReplyElementAtIndex(replyElements, index);
    if (!element) return false;
    // NOTE: this rAF helps prevent situations where the deeply nested thread element is unmounted
    requestAnimationFrame(() => element.scrollIntoView({ block: 'center' }));
    return true;
  };

  onMount(() => {
    props.onReady?.({
      scrollToIndex,
    });
  });

  return (
    <For each={props.replies}>
      {(reply, index) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        const isReplySelected = () =>
          !!props.isThreadFocused?.() && props.selectedReplyId?.() === reply.id;

        return (
          <div
            ref={(element) => {
              replyElements[index()] = element;
            }}
            class="relative"
          >
            <ThreadRail
              newMessage={listMetaByReplyId()[reply.id].isNewMessage}
            />
            <MarkMessageNotifications
              messageId={reply.id}
              channelId={props.channelId}
            >
              <ChannelMessage
                channelId={props.channelId}
                message={replyMessage()}
                actions={props.getMessageActions?.(replyMessage())}
                listMeta={listMetaByReplyId()[reply.id]}
                messageEditor={props.messageEditor}
                onClick={() => props.onSelectReply?.(reply.id)}
                highlighted={isReplySelected()}
                selectionState={
                  isReplySelected() ? { isSelected: true } : undefined
                }
              />
            </MarkMessageNotifications>
          </div>
        );
      }}
    </For>
  );
}
