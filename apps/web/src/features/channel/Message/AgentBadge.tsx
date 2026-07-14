import { isBotSenderId } from '@queries/channel/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type AgentBadgeProps = {
  class?: string;
};

/**
 * Small "Agent" badge shown next to a bot sender's name so it's clear the
 * message is from an agent rather than a person.
 */
export function AgentBadge(props: AgentBadgeProps) {
  const message = useMessage();
  const isAgent = () => isBotSenderId(message().sender_id);

  return (
    <Show when={isAgent()}>
      <span
        class={cn(
          'inline-flex shrink-0 items-center rounded-sm bg-hover px-2 py-0.5',
          'text-xs font-medium leading-none text-ink-muted',
          props.class
        )}
      >
        Agent
      </span>
    </Show>
  );
}
