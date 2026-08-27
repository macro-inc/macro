import type { IUser } from '@core/user/types';
import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';
import { type Accessor, createMemo, For, onCleanup, onMount } from 'solid-js';
import type { MessageEditor } from '../Channel/create-message-editor';
import type { NewMessageCheckable } from '../Channel/util';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import { createTargetReplyScroller } from './create-target-reply-scroller';
import { buildThreadReplyListMeta } from './reply-list-meta';
import { ThreadReplyRail } from './ThreadReplyRail';

export type ThreadReplyListHandle = {
  scrollToIndex: (index: number, onSettled: () => void) => boolean;
  cancelScroll: () => void;
};

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
  participants?: Accessor<IUser[]>;
  isNewMessage?: (message: NewMessageCheckable) => boolean;
  onReady?: (handle: ThreadReplyListHandle) => void;
  positionTarget?: (
    threadRow: HTMLElement,
    targetReply: HTMLElement
  ) => boolean;
  selectedReplyId?: Accessor<string | undefined>;
  /**
   * Reply targeted by channel navigation or bound to the unified input's reply (quote-reply).
   */
  targetedReplyId?: Accessor<string | undefined>;
  isThreadFocused?: Accessor<boolean>;
  onSelectReply?: (replyId: string) => void;
}) {
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies, props.isNewMessage)
  );
  const replyElements: Array<HTMLElement | undefined> = [];
  const targetReplyScroller = createTargetReplyScroller({
    getTarget: (index) => replyElements[index],
    positionTarget: props.positionTarget,
  });

  onMount(() => {
    props.onReady?.({
      scrollToIndex: targetReplyScroller.scrollToIndex,
      cancelScroll: targetReplyScroller.cancel,
    });
  });

  onCleanup(targetReplyScroller.dispose);

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
            <ThreadReplyRail
              grouped={listMetaByReplyId()[reply.id].isGroupedWithPrevious}
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
                participants={props.participants}
                onClick={() => props.onSelectReply?.(reply.id)}
                selected={isReplySelected()}
                targeted={props.targetedReplyId?.() === reply.id}
              />
            </MarkMessageNotifications>
          </div>
        );
      }}
    </For>
  );
}
