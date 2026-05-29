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
  const isAgent = () => message().sender_id.startsWith('bot|');

  return (
    <Show when={isAgent()}>
      <span
        class={cn(
          'shrink-0 rounded-md border border-ink/15 px-1 py-px',
          'text-[10px] font-medium uppercase leading-none tracking-wide text-ink-muted',
          props.class
        )}
      >
        Agent
      </span>
    </Show>
  );
}
