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
    return getThreadTypingIndicatorText(typingUsers());
  });

  const isActive = () => typingUsers().length > 0;

  return (
    <Show when={isActive()}>
      <ThreadTypingIndicatorContent text={typingText()} />
    </Show>
  );
}

type ThreadTypingIndicatorContentProps = {
  text: string;
};

function ThreadTypingIndicatorContent(props: ThreadTypingIndicatorContentProps) {
  return (
    <div class="flex flex-row items-stretch justify-start ml-[var(--left-of-connector)] min-h-7">
      <ThreadTypingIndicatorConnector />
      <div class="text-xs text-panel uppercase font-mono px-1 py-0.5 my-1 bg-edge flex items-center gap-1">
        <ThreadTypingIndicatorDots />
        <span>{props.text}</span>
      </div>
    </div>
  );
}

function ThreadTypingIndicatorConnector() {
  return (
    <>
      <div class="flex flex-col items-center justify-center">
        <div class="border-l border-edge-muted min-h-1/2" />
        <div class="border-l border-edge-muted min-h-1/2" />
      </div>
      <div class="flex flex-col items-center justify-center">
        <div class="w-7 border-b border-edge-muted" />
      </div>
    </>
  );
}

function ThreadTypingIndicatorDots() {
  return (
    <span class="flex">
      <span class="animate-typing-dot [animation-delay:0ms]">.</span>
      <span class="animate-typing-dot [animation-delay:200ms]">.</span>
      <span class="animate-typing-dot [animation-delay:400ms]">.</span>
    </span>
  );
}

function getThreadTypingIndicatorText(userIds: string[]): string {
  switch (userIds.length) {
    case 0:
      return '';
    case 1:
      return `${idToDisplayName(userIds[0])} is typing`;
    case 2:
      return `${idToDisplayName(userIds[0])} and ${idToDisplayName(userIds[1])} are typing`;
    default:
      return 'Multiple people are typing';
  }
}
