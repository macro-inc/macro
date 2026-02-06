import { useEmailContext } from '@block-email/component/EmailContext';
import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isMobile } from '@core/mobile/isMobile';
import { createMemo, createSelector, Index, type JSX, Show } from 'solid-js';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
  onScrollPositionChange?: (scrollFromTop: number) => void;
  title?: string;
  composeSlot?: JSX.Element;
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
        // Since the list is reversed, calculate scroll from visual top
        const scrollFromTop =
          e.currentTarget.scrollHeight +
          e.currentTarget.scrollTop -
          e.currentTarget.clientHeight;

        props.onScrollPositionChange?.(scrollFromTop);

        // Don't load more if we're programmatically scrolling to a message
        if (getIsScrollingToMessage() || !props.initialLoadComplete) return;

        const threshold = 300;
        const isNearBeginning = scrollFromTop <= threshold;

        if (
          isNearBeginning &&
          !context.query.isFetching() &&
          context.query.hasMore()
        ) {
          context.query.fetchNextPage();
        }
      }}
    >
      {props.composeSlot}
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

            const isLastMessage = createMemo(() => {
              return (
                normalizedIndex() === (context.messages.list().length ?? 0) - 1
              );
            });

            const isNewMessage = createMemo(() => {
              return (
                message().labels.find(
                  (l) => l.provider_label_id === 'UNREAD'
                ) !== undefined
              );
            });

            const isExpanded = createMemo(() => {
              const messageID = message().db_id;

              if (!messageID) return false;

              // If user has explicitly toggled, respect that
              const manualState = context.messages.expandedBodyIds[messageID];
              if (manualState !== undefined) return manualState;

              // Default: expand last message and unread messages
              return isLastMessage() || isNewMessage();
            });

            return (
              <MessageContainer
                isFirstMessage={normalizedIndex() === 0}
                isLastMessage={isLastMessage()}
                isFocused={isFocusedSelector(message().db_id ?? undefined)}
                isTarget={isTargetSelector(message().db_id ?? undefined)}
                message={message()}
                isExpanded={isExpanded()}
              />
            );
          }}
        </Index>
      </StaticMarkdownContext>
      <Show when={isMobile() && props.title}>
        <div class="shrink-0 w-full flex justify-center pb-2">
          <div class="macro-message-width w-full">
            <h1 class="text-2xl font-semibold text-ink pb-2">{props.title}</h1>
          </div>
        </div>
      </Show>
    </div>
  );
}
