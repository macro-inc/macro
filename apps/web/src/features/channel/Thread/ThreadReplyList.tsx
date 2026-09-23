import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import type {
  Message as EntityMessage,
  MessageParent,
} from '@service-storage/messages';
import {
  type Accessor,
  createMemo,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { MessageEditor } from '../Channel/create-message-editor';
import type { NewMessageCheckable } from '../Channel/util';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import { createTargetReplyScroller } from './create-target-reply-scroller';
import { buildThreadReplyListMeta } from './reply-list-meta';
import { ThreadReplyMonorail } from './ThreadReplyMonorail';
import { ThreadReplyRail } from './ThreadReplyRail';

export type ThreadReplyListHandle = {
  scrollToIndex: (index: number, onSettled: () => void) => boolean;
  cancelScroll: () => void;
};

export function ThreadReplyList(props: {
  parent: MessageParent;
  inputMode?: 'inline' | 'unified';
  threadId: string;
  replies: Array<EntityMessage>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  messageEditor?: MessageEditor;
  isNewMessage?: (message: NewMessageCheckable) => boolean;
  onReady?: (handle: ThreadReplyListHandle) => void;
  positionTarget?: (
    threadRow: HTMLElement,
    targetReply: HTMLElement
  ) => boolean;
  selectedReplyId?: Accessor<string | undefined>;
  /**
   * Reply targeted by channel navigation or referenced by the unified input.
   */
  targetedReplyId?: Accessor<string | undefined>;
  isThreadFocused?: Accessor<boolean>;
  onSelectReply?: (replyId: string) => void;
  /** Keep replies on the root's rail instead of branching each one off it. */
  monorail?: boolean;
}) {
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies, props.isNewMessage)
  );
  const repliesById = createMemo(
    () => new Map(props.replies.map((reply) => [reply.id, reply]))
  );
  const lastAvatarIndex = createMemo(() =>
    props.replies.findLastIndex(
      (reply) => !listMetaByReplyId()[reply.id]?.isGroupedWithPrevious
    )
  );
  const replyElements = new Map<string, HTMLElement>();
  const targetReplyScroller = createTargetReplyScroller({
    getTarget: (index) => replyElements.get(props.replies[index]?.id),
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
    <For each={[...repliesById().keys()]}>
      {(id) => {
        onCleanup(() => replyElements.delete(id));
        const replyMessage = () => ({
          ...repliesById().get(id)!,
          thread_id: props.threadId,
        });

        const isReplySelected = () =>
          !!props.isThreadFocused?.() && props.selectedReplyId?.() === id;

        return (
          <div
            ref={(element) => {
              replyElements.set(id, element);
            }}
            class="relative"
          >
            <Show
              when={props.monorail}
              fallback={
                <ThreadReplyRail
                  grouped={listMetaByReplyId()[id].isGroupedWithPrevious}
                />
              }
            >
              <Show when={listMetaByReplyId()[id].index <= lastAvatarIndex()}>
                <ThreadReplyMonorail
                  grouped={listMetaByReplyId()[id].isGroupedWithPrevious}
                  terminal={listMetaByReplyId()[id].index === lastAvatarIndex()}
                />
              </Show>
            </Show>
            <MarkMessageNotifications messageId={id} parent={props.parent}>
              <ChannelMessage
                parent={props.parent}
                inputMode={props.inputMode}
                message={replyMessage()}
                actions={props.getMessageActions?.(replyMessage())}
                listMeta={listMetaByReplyId()[id]}
                messageEditor={props.messageEditor}
                onClick={() => props.onSelectReply?.(id)}
                selected={isReplySelected()}
                targeted={props.targetedReplyId?.() === id}
              />
            </MarkMessageNotifications>
          </div>
        );
      }}
    </For>
  );
}
