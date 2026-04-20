import { Message, type MessageData } from '@channel/Message';
import { Thread } from '@channel/Thread';
import { ThreadRail } from '@channel/Thread/ThreadRail';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from '@channel/Thread/utils/thread-reply-indicator-helpers';
import { buildThreadReplyListMeta } from '@channel/Thread/reply-list-meta';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { MessageContext } from '@queries/preview';
import type { ApiThreadReply } from '@service-comms/client';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { openDocument } from '../core/BlockLink';

type ChannelMessageThreadCardProps = {
  channelId: string;
  messageId: string;
  message: MessageContext;
};

function toMessageData(msg: MessageContext): MessageData {
  return {
    id: msg.id,
    content: msg.content,
    sender_id: msg.sender_id,
    created_at: msg.created_at,
    updated_at: msg.updated_at,
    deleted_at: msg.deleted_at ?? null,
    edited_at: msg.edited_at ?? null,
    thread_id: msg.thread_id ?? null,
    attachments: [],
    reactions: [],
  };
}

function replyToMessageData(
  reply: ApiThreadReply,
  threadId: string
): MessageData {
  return {
    id: reply.id,
    content: reply.content,
    sender_id: reply.sender_id,
    created_at: reply.created_at,
    updated_at: reply.updated_at,
    edited_at: reply.edited_at ?? null,
    thread_id: threadId,
    attachments: reply.attachments,
    reactions: reply.reactions,
  };
}

export function ChannelMessageThreadCard(props: ChannelMessageThreadCardProps) {
  return (
    <Suspense>
      <ChannelMessageThreadCardInner {...props} />
    </Suspense>
  );
}

function ChannelMessageThreadCardInner(props: ChannelMessageThreadCardProps) {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const repliesQuery = useThreadRepliesQuery(
    () => props.channelId,
    () => props.messageId,
    () => true
  );

  const replies = () => repliesQuery.data ?? [];
  const hasReplies = () => replies().length > 0;

  const displayReplies = () => {
    if (isExpanded()) return replies();
    return replies().slice(0, DEFAULT_VISIBLE_REPLY_COUNT);
  };

  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(replies().length, DEFAULT_VISIBLE_REPLY_COUNT);

  const collapsedReplyUsers = () =>
    getUniqueReplyUserIds(replies().slice(DEFAULT_VISIBLE_REPLY_COUNT));

  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(undefined, replies());

  const shouldShowCollapsedIndicator = () =>
    !isExpanded() && collapsedRepliesCount() > 0;

  const parentMessage = () => toMessageData(props.message);

  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(displayReplies())
  );

  const navigateToMessage = (e: MouseEvent) => {
    e.stopPropagation();
    openDocument('channel', props.channelId, {
      [CHANNEL_PARAMS.message]: props.messageId,
    });
  };

  return (
    <div class="relative">
      <Show when={hasReplies()}>
        <ThreadRail />
      </Show>

      <Message.Root
        message={parentMessage()}
        onClick={navigateToMessage}
        class="cursor-pointer hover:bg-hover"
      >
        <Message.Layout class="pt-(--regular-message-padding-t)">
          <Message.Slot placement="icon">
            <Message.SenderIcon />
          </Message.Slot>
          <Message.Slot
            placement="header"
            class="flex items-center gap-1 min-w-0"
          >
            <Message.SenderName />
            <Message.EditedIndicator />
            <Message.Timestamp class="ml-auto shrink-0" format="dateAndTime" />
          </Message.Slot>
          <Message.Slot placement="content">
            <Message.Content />
          </Message.Slot>
        </Message.Layout>
      </Message.Root>

      <Show when={hasReplies()}>
        <div class="relative w-full">
          <Thread.ReplyRailDecorations
            isReplying={() => false}
            firstThreadReplyNewMessage={false}
          />
          <Thread.RepliesContainer>
            <For each={displayReplies()}>
              {(reply) => {
                const replyMessage = () =>
                  replyToMessageData(reply, props.messageId);
                const meta = () => listMetaByReplyId()[reply.id];
                return (
                  <div class="relative">
                    <ThreadRail />
                    <Message.Root
                      message={replyMessage()}
                      onClick={navigateToMessage}
                      class="cursor-pointer hover:bg-hover"
                    >
                      <Message.Layout
                        class={
                          meta()?.isGroupedWithPrevious
                            ? undefined
                            : 'pt-(--regular-message-padding-t)'
                        }
                      >
                        <Message.Slot placement="icon">
                          <Message.SenderIcon
                            hidden={meta()?.isGroupedWithPrevious}
                          />
                        </Message.Slot>
                        <Show when={!meta()?.isGroupedWithPrevious}>
                          <Message.Slot
                            placement="header"
                            class="flex items-center gap-1 min-w-0"
                          >
                            <Message.SenderName />
                            <Message.EditedIndicator />
                            <Message.Timestamp
                              class="ml-auto shrink-0"
                              format="dateAndTime"
                            />
                          </Message.Slot>
                        </Show>
                        <Message.Slot placement="content">
                          <Message.Content />
                        </Message.Slot>
                        <Message.Slot
                          placement="footer"
                          class="flex flex-col min-w-0"
                        >
                          <Message.Attachments />
                          <Message.Reactions />
                        </Message.Slot>
                      </Message.Layout>
                    </Message.Root>
                  </div>
                );
              }}
            </For>

            <Show when={shouldShowCollapsedIndicator()}>
              <Thread.ActionsFooter>
                <Thread.CollapsedIndicator
                  collapsedRepliesCount={collapsedRepliesCount()}
                  participants={collapsedReplyUsers()}
                  latestReplyAt={collapsedLatestReplyAt()}
                  onClick={() => setIsExpanded(true)}
                />
              </Thread.ActionsFooter>
            </Show>
          </Thread.RepliesContainer>
        </div>
      </Show>
    </div>
  );
}
