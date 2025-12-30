import { useNextEmailContext } from '@block-email/component/NextEmailContext';
import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { createSelector, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
}

export function MessageList(props: MessageListProps) {
  const getIsScrollingToMessage = isScrollingToMessage.get;
  const context = useNextEmailContext();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});
  const isFocusedSelector = createSelector(
    context.messages.focusedID,
    (a, b) => !!a && !!b && a === b
  );
  const isTargetSelector = createSelector(
    context.messages.targetMessageID,
    (a, b) => !!a && !!b && a === b
  );

  return (
    <div
      class="pt-3 w-full flex flex-col-reverse items-center overflow-y-scroll overflow-x-hidden suppress-css-brackets"
      ref={context.registerMessagesList}
      onscroll={(e) => {
        // Don't load more if we're programmatically scrolling to a message
        if (getIsScrollingToMessage() || !props.initialLoadComplete) return;

        const threshold = 300;

        // Since the list is reversed, the scrollTop is negative. So we get the scroll position
        // from the bottom up using the scrollHeight and clientHeight
        const currentScrollPosition =
          e.currentTarget.scrollHeight +
          e.currentTarget.scrollTop -
          e.currentTarget.clientHeight;

        const isNearBeginning = currentScrollPosition <= threshold;

        if (
          isNearBeginning &&
          !context.query.isFetching() &&
          context.query.hasMore()
        ) {
          context.query.fetchNextPage();
        }
      }}
    >
      <For each={context.messages.list().toReversed()}>
        {(message, listIndex) => {
          const index = () => {
            // If the index here is 0 but we still have more data to fetch,
            // the index is technically incorrect and will lead to isFirstMessage
            // to be wrong
            if (listIndex() === 0 && context.query.hasMore()) {
              return -1;
            }

            return listIndex();
          };

          return (
            <MessageContainer
              isFirstMessage={index() === 0}
              isLastMessage={
                index() === (context.messages.list().length ?? 0) - 1
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

      <Show when={context.query.isFetching()}>
        <div class="flex items-center justify-center h-16">
          <CircleSpinner />
        </div>
      </Show>
    </div>
  );
}
