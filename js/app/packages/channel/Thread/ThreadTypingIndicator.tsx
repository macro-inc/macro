import { idToDisplayName } from '@core/user';
import { getTypingUsersForChannel } from '@queries/channel/typing';
import { createMemo, Show } from 'solid-js';
import { match } from 'ts-pattern';

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
    <div class="flex flex-row items-stretch justify-start ml-(--left-of-connector) min-h-7">
      <Show when={isActive()}>
        <ThreadTypingIndicatorContent text={typingText()} />
      </Show>
    </div>
  );
}

type ThreadTypingIndicatorContentProps = {
  text: string;
};

function ThreadTypingIndicatorContent(
  props: ThreadTypingIndicatorContentProps
) {
  return (
    <div class="flex items-center">
      <ThreadTypingIndicatorConnector />
      <div class="size-0 bg-rail rounded-sm" />
      <span class="text-xs text-ink-extra-muted ml-2">{props.text}</span>
      <ThreadTypingIndicatorDots />
    </div>
  );
}

function ThreadTypingIndicatorConnector() {
  return <div class="w-7 border-b border-rail" />;
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
  return match(userIds.length)
    .with(0, () => '')
    .with(1, () => `${idToDisplayName(userIds[0])} is typing`)
    .with(
      2,
      () =>
        `${idToDisplayName(userIds[0])} and ${idToDisplayName(userIds[1])} are typing`
    )
    .otherwise(() => 'Multiple people are typing');
}
