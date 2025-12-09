import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { createSelector, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useEmailContext } from './EmailContext';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
}

export function MessageList(props: MessageListProps) {
  const getIsScrollingToMessage = isScrollingToMessage.get;
  const context = useEmailContext();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});
  const isFocusedSelector = createSelector(
    context.focusedMessageId,
    (a, b) => !!a && !!b && a === b
  );
  const isTargetSelector = createSelector(
    context.activeTargetMessageId,
    (a, b) => !!a && !!b && a === b
  );

  return (
    <div
      class="pt-3 w-full flex-1 flex flex-col items-center overflow-y-scroll overflow-x-hidden suppress-css-brackets"
      ref={context.setMessagesRef}
      onscroll={(e) => {
        // Don't load more if we're programmatically scrolling to a message
        if (getIsScrollingToMessage() || !props.initialLoadComplete) return;

        const threshold = 300;
        const isNearBeginning = e.currentTarget.scrollTop <= threshold;

        if (isNearBeginning && !context.isFetching() && context.hasMore()) {
          context.fetchNextPage();
        }
      }}
    >
      <Show when={context.isFetching()}>
        <div class="flex items-center justify-center h-16">
          <CircleSpinner />
        </div>
      </Show>
      <For each={context.filteredMessages()}>
        {(message, index) => {
          return (
            <MessageContainer
              isFirstMessage={index() === 0}
              isLastMessage={
                index() === (context.filteredMessages().length ?? 0) - 1
              }
              isFocused={isFocusedSelector(message.db_id ?? undefined)}
              isTarget={isTargetSelector(message.db_id ?? undefined)}
              message={message}
              expandedMessageBodyIds={expandedMessageBodyIds}
              setExpandedMessageBodyIds={setExpandedMessageBodyIds}
            />
          );
        }}
      </For>
    </div>
  );
}
