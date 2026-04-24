import { getTypingUsersForChannel } from '@queries/channel/typing';
import { idToDisplayName } from '@core/user';
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
    <>
      <ThreadTypingIndicatorConnector />
      <div class="text-xs text-panel uppercase font-mono px-1 py-0.5 my-1 bg-edge flex items-center gap-1">
        <ThreadTypingIndicatorDots />
        <span>{props.text}</span>
      </div>
    </>
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
