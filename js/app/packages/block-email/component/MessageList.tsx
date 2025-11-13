import { CircleSpinner } from '@core/component/CircleSpinner';
import { For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useEmailContext } from './EmailContext';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  isScrollingToMessage: () => boolean;
  initialLoadComplete: boolean;
}

export function MessageList(props: MessageListProps) {
  const context = useEmailContext();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});

  const isScrollingToMessage = props.isScrollingToMessage;

  return (
    <div
      class="pt-3 w-full flex-1 flex flex-col items-center overflow-y-scroll overflow-x-hidden suppress-css-brackets"
      ref={context.setMessagesRef}
      onscroll={(e) => {
        // Don't load more if we're programmatically scrolling to a message
        if (isScrollingToMessage() || !props.initialLoadComplete) return;

        const threshold = 300;
        const isNearBeginning = e.currentTarget.scrollTop <= threshold;

        const resource = context.threadMessagesResource();
        if (isNearBeginning && resource && !resource.loading()) {
          const resourceData = resource.resource();
          if (resourceData?.hasMore) {
            resource.loadMore();
          }
        }
      }}
    >
      <Show when={context.threadMessagesResource()?.loading()}>
        <div class="flex items-center justify-center h-16">
          <CircleSpinner />
        </div>
      </Show>
      <For each={context.filteredMessages()}>
        {(message, index) => {
          return (
            <MessageContainer
              message={message}
              index={index}
              expandedMessageBodyIds={expandedMessageBodyIds}
              setExpandedMessageBodyIds={setExpandedMessageBodyIds}
            />
          );
        }}
      </For>
    </div>
  );
}
