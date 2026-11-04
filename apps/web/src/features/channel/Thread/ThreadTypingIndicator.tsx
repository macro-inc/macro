import { AgentTyping } from '@app/features/agent-activity/agent-typing';
import { idToDisplayName } from '@core/user';
import { getTypingAgents, getTypingUsers } from '@queries/messages/typing';
import type { MessageParent } from '@service-storage/messages';
import { createMemo, Show } from 'solid-js';
import { match } from 'ts-pattern';

type ThreadTypingIndicatorProps = {
  parent: MessageParent;
  threadId: string | null;
};

export function ThreadTypingIndicator(props: ThreadTypingIndicatorProps) {
  // Agents type as a row of their own, with their turn beneath.
  const typingUsers = createMemo(() => {
    const agents = getTypingAgents(props.parent, props.threadId);
    const users = getTypingUsers(props.parent, props.threadId);
    return Array.from(users).filter((user) => !agents.has(user));
  });

  const typingText = createMemo(() => {
    return getThreadTypingIndicatorText(typingUsers());
  });

  const isActive = () => typingUsers().length > 0;

  return (
    <>
      <AgentTyping parent={props.parent} threadId={props.threadId} />
      <div class="flex flex-row items-stretch justify-start ml-[calc(var(--message-padding-x)+var(--user-icon-width)+--spacing(2))] min-h-7">
        <Show when={isActive()}>
          <ThreadTypingIndicatorContent text={typingText()} />
        </Show>
      </div>
    </>
  );
}

type ThreadTypingIndicatorContentProps = {
  text: string;
};

function ThreadTypingIndicatorContent(
  props: ThreadTypingIndicatorContentProps
) {
  return (
    <div class="flex items-center text-ink-extra-muted">
      <span class="text-xs">{props.text}</span>
      <ThreadTypingIndicatorDots />
    </div>
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
