import { usersTypingSignal } from '@block-channel/signal/typing';
import { Message } from '@core/component/Message';
import { idToDisplayName } from '@core/user';
import type { Message as MessageType } from '@service-comms/generated/models/message';
import { createMemo, Show } from 'solid-js';

type TypingIndicatorProps = {
  threadId?: string;
  previousMessage?: MessageType;
};

export function TypingIndicator(props: TypingIndicatorProps) {
  const typingUsers = createMemo(() => {
    const users =
      usersTypingSignal.get().get(props.threadId ?? null) ?? new Set();
    return Array.from(users);
  });

  const typingText = () => {
    switch (typingUsers().length) {
      case 0: {
        return '';
      }
      case 1: {
        return `${idToDisplayName(typingUsers()[0])} is typing...`;
      }
      case 2: {
        return `${idToDisplayName(typingUsers()[0])} and ${idToDisplayName(typingUsers()[1])} are typing...`;
      }
      default: {
        return 'multiple people are typing...';
      }
    }
  };

  const isConsecutive = createMemo(() => {
    if (!props.previousMessage) return false;
    return (
      typingUsers().length === 1 &&
      props.previousMessage.sender_id === typingUsers()[0]
    );
  });

  return (
    <Show when={typingUsers().length > 0}>
      <Message
        senderId={typingUsers().length > 1 ? undefined : typingUsers()[0]}
        focused={false}
        isFirstMessage={false}
        isLastMessage={false}
        isFirstInThread={false}
        isLastInThread={false}
        isConsecutive={isConsecutive()}
      >
        <Message.TopBar name={typingText()} />
        <Message.Body>
          <div class="flex flex-row items-center font-mono text-xs">
            <div class="my-1.5 flex">
              <span class="animate-typing-dot [animation-delay:0ms]">.</span>
              <span class="animate-typing-dot [animation-delay:200ms]">.</span>
              <span class="animate-typing-dot [animation-delay:400ms]">.</span>
            </div>
          </div>
        </Message.Body>
      </Message>
    </Show>
  );
}
