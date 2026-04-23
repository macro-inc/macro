import { createMemo, For, Show } from 'solid-js';
import { Message, type MessageActions, type MessageData } from '../Message';
import { Thread } from '../Thread';
import { ThreadRail } from '../Thread/ThreadRail';
import { buildThreadReplyListMeta } from '../Thread/reply-list-meta';
import {
  DEFAULT_VISIBLE_REPLY_COUNT,
  getCollapsedRepliesCount,
  getThreadLatestReplyAt,
  getUniqueReplyUserIds,
} from '../Thread/utils/thread-reply-indicator-helpers';
import { useStandaloneThread } from './context';

type RepliesProps = {
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
  class?: string;
  showReplyButton?: boolean;
};

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

  const shouldShowReplyButton = () =>
    !!props.showReplyButton &&
    ctx.hasReplies() &&
    !ctx.isReplying() &&
    !shouldShowCollapsedIndicator();

  return (
    <Show when={ctx.hasReplies() || ctx.isReplying()}>
      <div class="relative w-full">
        <Thread.ReplyRailDecorations
          isReplying={ctx.isReplying}
          firstThreadReplyNewMessage={false}
        />
        <Thread.RepliesContainer>
          <For each={ctx.displayReplies()}>
            {(reply) => {
              const meta = () => listMetaByReplyId()[reply.id];
              const replyActions = () => props.getMessageActions?.(reply);
              return (
                <div class="relative">
                  <ThreadRail />
                  <Message.Root
                    message={reply}
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
                    <Show when={replyActions()}>
                      <Message.ActionMenu />
                    </Show>
                  </Message.Root>
                </div>
              );
            }}
          </For>
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
                  onClick={() => ctx.setIsReplying(true)}
                  aria-label="Reply"
                />
              </Show>
            </Thread.ActionsFooter>
          </Show>
        </Thread.RepliesContainer>
      </div>
    </Show>
  );
}
