import { getTypingUsersForChannel } from '@queries/channel/typing';
import { createMemo, Show } from 'solid-js';
import { ThreadTypingIndicatorContent } from './ThreadTypingIndicatorContent';
import { getThreadTypingIndicatorText } from './utils/thread-typing-indicator';

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
