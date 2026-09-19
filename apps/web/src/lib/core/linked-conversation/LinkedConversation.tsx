import {
  type GroupableMessage,
  shouldGroupWithPreviousMessage,
} from '@channel/Channel/message-grouping-meta';
import { Message } from '@channel/Message/Message';
import type { MessageData } from '@channel/Message/types';
import { Thread } from '@channel/Thread/Thread';
import { ThreadRail } from '@channel/Thread/ThreadRail';
import { ThreadReplyRail } from '@channel/Thread/ThreadReplyRail';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from '@channel/Thread/utils/thread-reply-indicator-helpers';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { senderFromStorageId } from '@queries/channel/message-sender';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import type { LinkedConversationSource } from './types';

type LinkedConversationProps = {
  source: LinkedConversationSource;
  /** Navigate-style click handler; message rows get a hover affordance when set. */
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
  class?: string;
};

/**
 * Read-only rendering of a linked conversation — a root message and its reply
 * chain — from a [`LinkedConversationSource`]. Source-agnostic: back it with
 * `createChannelThreadSource` for channel threads, or supply another source.
 * Long reply chains collapse behind a `Thread.CollapsedIndicator` and expand
 * in place.
 */
export function LinkedConversation(props: LinkedConversationProps) {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const replies = () => props.source.replies();
  const hasReplies = () => replies().length > 0;
  const totalReplyCount = () => props.source.replyCount?.() ?? replies().length;

  const displayReplies = () =>
    isExpanded() ? replies() : replies().slice(0, DEFAULT_VISIBLE_REPLY_COUNT);
  const isGroupedById = createMemo(() => buildIsGroupedById(displayReplies()));

  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(totalReplyCount());
  const showCollapsedIndicator = () =>
    !isExpanded() && collapsedRepliesCount() > 0;
  const collapsedReplyUsers = () =>
    getUniqueReplyUserIds(replies().slice(DEFAULT_VISIBLE_REPLY_COUNT));
  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(undefined, replies());

  const rowClass = () => (props.onClickMessage ? 'hover:bg-hover' : undefined);

  return (
    <StaticMarkdownContext>
      <Suspense>
        <div class={cn('relative', props.class)}>
          <Show when={hasReplies()}>
            <ThreadRail />
          </Show>
          <Show when={props.source.root()}>
            {(rootMessage) => (
              <ConversationMessage
                message={rootMessage()}
                onClick={props.onClickMessage}
                class={rowClass()}
              />
            )}
          </Show>
          <Show when={hasReplies()}>
            <div class="relative w-full">
              <Thread.ReplyRailDecorations />
              <Thread.RepliesContainer>
                <For each={displayReplies()}>
                  {(reply) => (
                    <div class="relative">
                      <ThreadReplyRail grouped={isGroupedById()[reply.id]} />
                      <ConversationMessage
                        message={reply}
                        grouped={isGroupedById()[reply.id]}
                        onClick={props.onClickMessage}
                        class={rowClass()}
                      />
                    </div>
                  )}
                </For>
                <Show when={showCollapsedIndicator()}>
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
      </Suspense>
    </StaticMarkdownContext>
  );
}

function ConversationMessage(props: {
  message: MessageData;
  grouped?: boolean;
  onClick?: (messageId: string, e: MouseEvent) => void;
  class?: string;
}) {
  return (
    <Message.Root
      message={props.message}
      onClick={
        props.onClick
          ? (e: MouseEvent) => props.onClick!(props.message.id, e)
          : undefined
      }
      class={props.class}
    >
      <Message.Layout
        class={props.grouped ? undefined : 'pt-(--regular-message-padding-t)'}
      >
        <Message.Slot placement="icon">
          <Message.SenderIcon hidden={props.grouped} />
        </Message.Slot>
        <Show when={!props.grouped}>
          <Message.Slot
            placement="header"
            class="flex flex-col gap-0.5 min-w-0"
          >
            <div class="flex items-center gap-1 min-w-0">
              <Message.SenderName />
              <Message.AgentBadge />
              <Message.EditedIndicator />
              <Message.Timestamp
                class="ml-auto shrink-0"
                format="dateAndTime"
              />
            </div>
            <Message.FromPill />
          </Message.Slot>
        </Show>
        <Message.Slot placement="content">
          <Message.Content />
        </Message.Slot>
        <Message.Slot placement="footer" class="flex flex-col min-w-0">
          <Message.Attachments />
          <Message.Reactions />
        </Message.Slot>
      </Message.Layout>
    </Message.Root>
  );
}

function toGroupable(message: MessageData): GroupableMessage {
  return {
    id: message.id,
    sender_id: message.sender_id,
    sender: message.sender ?? senderFromStorageId(message.sender_id),
    created_at: message.created_at,
    attachments: message.attachments,
    deleted_at: message.deleted_at ?? null,
  };
}

/**
 * Grouping over `MessageData` rather than `buildThreadReplyListMeta`'s
 * `ApiThreadReply` — linked-conversation messages may come from non-channel
 * sources where `sender` is absent.
 */
function buildIsGroupedById(replies: MessageData[]): Record<string, boolean> {
  const grouped: Record<string, boolean> = {};
  let previous: GroupableMessage | undefined;
  for (const reply of replies) {
    const current = toGroupable(reply);
    grouped[reply.id] = shouldGroupWithPreviousMessage(current, previous);
    previous = current;
  }
  return grouped;
}
