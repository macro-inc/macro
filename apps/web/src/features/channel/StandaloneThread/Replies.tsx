import { createMemo, For, type ParentProps, Show } from 'solid-js';
import { Message, type MessageActions, type MessageData } from '../Message';
import { Thread } from '../Thread';
import { buildThreadReplyListMeta } from '../Thread/reply-list-meta';
import { ThreadReplyRail } from '../Thread/ThreadReplyRail';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from '../Thread/utils/thread-reply-indicator-helpers';
import { useStandaloneThread } from './context';

type RepliesProps = ParentProps<{
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
  class?: string;
  showReplyButton?: boolean;
}>;

export function Replies(props: RepliesProps) {
  const ctx = useStandaloneThread();

  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(ctx.displayReplies())
  );

  const collapsedRepliesCount = () =>
    getCollapsedRepliesCount(
      ctx.parent()?.thread.reply_count ?? ctx.replies().length,
      DEFAULT_VISIBLE_REPLY_COUNT
    );

  const collapsedReplyUsers = () =>
    getUniqueReplyUserIds(ctx.replies().slice(DEFAULT_VISIBLE_REPLY_COUNT));

  const collapsedLatestReplyAt = () =>
    getThreadLatestReplyAt(ctx.parent()?.thread.latest_reply_at, ctx.replies());

  const shouldShowCollapsedIndicator = () =>
    !ctx.isReplying() && !ctx.isExpanded() && collapsedRepliesCount() > 0;

  const replyAction = () => {
    const parent = ctx.parent();
    if (!parent) return undefined;
    return props.getMessageActions?.(parent)?.onReply;
  };

  const shouldShowReplyButton = () =>
    !!props.showReplyButton &&
    ctx.hasReplies() &&
    !!replyAction() &&
    !ctx.isReplying() &&
    !shouldShowCollapsedIndicator();

  const hasTrailingRailTarget = () =>
    props.children !== undefined ||
    shouldShowCollapsedIndicator() ||
    shouldShowReplyButton();

  const finalReplyBranchIndex = createMemo(() => {
    const replies = ctx.displayReplies();
    for (let index = replies.length - 1; index >= 0; index -= 1) {
      if (!listMetaByReplyId()[replies[index].id]?.isGroupedWithPrevious) {
        return index;
      }
    }
    return -1;
  });

  return (
    <Show when={ctx.hasReplies() || ctx.isReplying()}>
      <div class="relative w-full">
        <Thread.RepliesBridgeRail />
        <Thread.RepliesContainer>
          <For each={ctx.displayReplies()}>
            {(reply, index) => {
              const replyMessage = () =>
                ({ ...reply, thread_id: ctx.messageId() }) as MessageData;
              const meta = () => listMetaByReplyId()[reply.id];
              const replyActions = () =>
                props.getMessageActions?.(replyMessage());
              return (
                <div class="relative">
                  <ThreadReplyRail
                    grouped={meta()?.isGroupedWithPrevious}
                    terminal={
                      !hasTrailingRailTarget() &&
                      index() >= finalReplyBranchIndex()
                    }
                  />
                  <Message.Root
                    message={replyMessage()}
                    actions={replyActions()}
                    onClick={
                      props.onClickMessage
                        ? (e: MouseEvent) => props.onClickMessage!(reply.id, e)
                        : undefined
                    }
                    class={props.class}
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
                          class="flex flex-col gap-0.5 min-w-0"
                        >
                          <div class="flex items-baseline gap-1.5 min-w-0">
                            <Message.SenderName />
                            <Message.AgentBadge />
                            <Message.Timestamp
                              class="shrink-0"
                              format="dateAndTime"
                            />
                            <Message.EditedIndicator class="shrink-0" />
                          </div>
                          <Message.FromPill />
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
                    <Show when={replyActions()}>
                      <Message.ActionMenu />
                    </Show>
                  </Message.Root>
                </div>
              );
            }}
          </For>
          {props.children}
          <Show
            when={shouldShowCollapsedIndicator() || shouldShowReplyButton()}
          >
            <Thread.ActionsFooter>
              <Show when={shouldShowCollapsedIndicator()}>
                <Thread.CollapsedIndicator
                  collapsedRepliesCount={collapsedRepliesCount()}
                  participants={collapsedReplyUsers()}
                  latestReplyAt={collapsedLatestReplyAt()}
                  onClick={() => ctx.setIsExpanded(true)}
                />
              </Show>
              <Show when={shouldShowReplyButton()}>
                <Thread.ReplyButton
                  getFocusTarget={() => null}
                  onClick={(event) => {
                    const parent = ctx.parent();
                    if (!parent) return;
                    replyAction()?.({ message: parent, event });
                  }}
                  aria-label="Reply"
                />
              </Show>
            </Thread.ActionsFooter>
          </Show>
        </Thread.RepliesContainer>
        <Show when={shouldShowCollapsedIndicator() || shouldShowReplyButton()}>
          <Thread.TerminalRail />
        </Show>
      </div>
    </Show>
  );
}
