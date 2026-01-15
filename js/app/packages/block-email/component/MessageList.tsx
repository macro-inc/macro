import { useEmailContext } from '@block-email/component/EmailContext';
import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createMemo, createSelector, Index, Show } from 'solid-js';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
  title: string;
}

export function MessageList(props: MessageListProps) {
  const getIsScrollingToMessage = isScrollingToMessage.get;
  const context = useEmailContext();
  const isFocusedSelector = createSelector(
    context.messages.focusedID,
    (a, b) => !!a && !!b && a === b
  );
  const isTargetSelector = createSelector(
    context.messages.targetMessageID,
    (a, b) => a === b
  );

  return (
    <div
      class="pt-3 w-full flex flex-col-reverse items-center overflow-y-scroll overflow-x-hidden suppress-css-brackets hide-scrollbar text-sm touch:mobile-width:text-base"
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
      <StaticMarkdownContext>
        {/* We use Index because the index of the messages should always be stable and
          only the value changes. This also helps prevent nested inputs from rerendering
        */}
        <Index each={context.messages.list().toReversed()}>
          {(message, index) => {
            // We need the index as if the list was not reversed
            const normalizedIndex = createMemo(() => {
              const listLength = context.messages.list().length;

              const normalized = listLength - 1 - index;

              // The element at the 0th index isn't actually the first message
              // if there is more data to load so we return -1 so that `isFirstMessage`
              // evaluates to false. This fixes an issue with the "first" message' full
              // html to show in `EmailMessageBody`
              if (normalized === 0 && context.query.hasMore()) {
                return -1;
              }

              return normalized;
            });

            return (
              <MessageContainer
                isFirstMessage={normalizedIndex() === 0}
                isLastMessage={
                  normalizedIndex() ===
                  (context.messages.list().length ?? 0) - 1
                }
                isFocused={isFocusedSelector(message().db_id ?? undefined)}
                isTarget={isTargetSelector(message().db_id ?? undefined)}
                message={message()}
              />
            );
          }}
        </Index>
      </StaticMarkdownContext>
      <Show when={props.title}>
        <div class="shrink-0 w-full flex justify-center pb-4">
          <div class="macro-message-width w-full">
            <h1 class="text-4xl font-semibold text-ink pt-8 pb-4">
              {props.title}
            </h1>
          </div>
        </div>
      </Show>
    </div>
  );
}
