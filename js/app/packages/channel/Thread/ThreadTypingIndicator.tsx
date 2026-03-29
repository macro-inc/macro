import { getTypingUsersForChannel } from '@queries/channel/typing';
import { idToDisplayName } from '@core/user';
import { createMemo, Show } from 'solid-js';

type ThreadTypingIndicatorProps = {
  channelId: string;
  threadId: string | null;
};

export function ThreadTypingIndicator(props: ThreadTypingIndicatorProps) {
  const typingUsers = createMemo(() => {
    const users = getTypingUsersForChannel(props.channelId, props.threadId);
    return Array.from(users);
  });

  const typingText = createMemo(() => {
    const users = typingUsers();
    switch (users.length) {
      case 0:
        return '';
      case 1:
        return `${idToDisplayName(users[0])} is typing`;
      case 2:
        return `${idToDisplayName(users[0])} and ${idToDisplayName(users[1])} are typing`;
      default:
        return 'Multiple people are typing';
    }
  });

  const isActive = () => typingUsers().length > 0;

  return (
    <div class="flex flex-row items-stretch justify-start ml-[var(--left-of-connector)] min-h-7">
      <Show when={isActive()}>
        <div class="flex flex-col items-center justify-center">
          <div class="border-l border-edge-muted min-h-1/2" />
          <div class="border-l border-edge-muted min-h-1/2" />
        </div>
        <div class="flex flex-col items-center justify-center">
          <div class="w-7 border-b border-edge-muted" />
        </div>
        <div class="text-xs text-panel uppercase font-mono px-1 py-0.5 my-1 bg-edge flex items-center gap-1">
          <span class="flex">
            <span class="animate-typing-dot [animation-delay:0ms]">.</span>
            <span class="animate-typing-dot [animation-delay:200ms]">.</span>
            <span class="animate-typing-dot [animation-delay:400ms]">.</span>
          </span>
          <span>{typingText()}</span>
        </div>
      </Show>
    </div>
  );
}
