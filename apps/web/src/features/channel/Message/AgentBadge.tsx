import { isAgentUser, tryMacroId } from '@core/user';
import { isBotSenderId } from '@queries/messages/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type AgentBadgeProps = {
  class?: string;
};

/** Whether a principal id is an agent: a bot, or a team agent's account. */
export function isAgentPrincipal(id: string): boolean {
  return isBotSenderId(id) || isAgentUser(tryMacroId(id));
}

/** The "Agent" pill shown beside an agent's name. */
export function AgentChip(props: AgentBadgeProps) {
  return (
    <span
      class={cn(
        'inline-flex shrink-0 items-center rounded-full bg-hover px-1.5 py-0.5',
        'text-xs font-medium leading-none text-ink-muted',
        props.class
      )}
    >
      Agent
    </span>
  );
}

/**
 * Small "Agent" badge shown next to an agent sender's name so it's clear the
 * message is from an agent rather than a person.
 */
export function AgentBadge(props: AgentBadgeProps) {
  const message = useMessage();

  return (
    <Show when={isAgentPrincipal(message().sender_id)}>
      <AgentChip class={props.class} />
    </Show>
  );
}
