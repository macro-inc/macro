import { AgentTyping } from '@app/features/agent-activity/agent-typing';
import { idToDisplayName } from '@core/user';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { getTypingAgents, getTypingUsers } from '@queries/messages/typing';
import type { MessageParent } from '@service-storage/messages';
import { createMemo, type JSX, Match, Show, Switch } from 'solid-js';

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

  const isActive = () => typingUsers().length > 0;

  return (
    <>
      <AgentTyping parent={props.parent} threadId={props.threadId} />
      <div class="flex flex-row items-stretch justify-start ml-[calc(var(--message-padding-x)+var(--user-icon-width)+--spacing(2))] min-h-7">
        <Show when={isActive()}>
          <ThreadTypingIndicatorContent ids={typingUsers()} />
        </Show>
      </div>
    </>
  );
}

type ThreadTypingIndicatorContentProps = {
  ids: string[];
};

function ThreadTypingIndicatorContent(
  props: ThreadTypingIndicatorContentProps
) {
  return (
    <div class="flex items-center text-ink-extra-muted">
      <span class="text-xs">
        <Switch fallback="Multiple people are typing">
          <Match when={props.ids.length === 1}>
            <TypingName id={props.ids[0]} /> is typing
          </Match>
          <Match when={props.ids.length === 2}>
            <TypingName id={props.ids[0]} /> and{' '}
            <TypingName id={props.ids[1]} /> are typing
          </Match>
        </Switch>
      </span>
      <ThreadTypingIndicatorDots />
    </div>
  );
}

const BOT_PRINCIPAL_PREFIX = 'bot|';

/** A person by display name, or a bot that types without an agent session by its profile. */
function TypingName(props: { id: string }): JSX.Element {
  const botId = () =>
    props.id.startsWith(BOT_PRINCIPAL_PREFIX)
      ? props.id.slice(BOT_PRINCIPAL_PREFIX.length)
      : '';
  const profile = useBotProfile(botId);
  const botName = () => {
    if (queryReadyGate(profile)) return profile.data?.name ?? 'Agent';
    return profile.isError ? 'Agent' : '';
  };
  return (
    <Show when={botId()} fallback={idToDisplayName(props.id)}>
      {botName()}
    </Show>
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
