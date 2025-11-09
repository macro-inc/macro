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
      class="w-full flex-1 flex flex-col items-center overflow-y-scroll suppress-css-brackets"
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
      <div
        class="w-full pt-3 flex flex-col items-center"
        ref={context.setMessagesRef}
      >
        <Show when={context.threadMessagesResource()?.loading()}>
          <div class="flex items-center justify-center h-16 w-full">
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
    </div>
  );
}
