import { AgentTag } from '@core/component/AgentTag';
import { isAgentAccount, tryMacroId } from '@core/user';
import { isBotSenderId } from '@queries/messages/message-sender';
import { Show } from 'solid-js';
import { useMessage } from './context';

type AgentBadgeProps = {
  class?: string;
};

/** A bot, or a user account an agent works as. */
export function isAgentSenderId(senderId: string): boolean {
  return isBotSenderId(senderId) || isAgentAccount(tryMacroId(senderId));
}

/**
 * Small "Agent" badge shown next to a bot or agent account's name so it's
 * clear the message is from an agent rather than a person.
 */
export function AgentBadge(props: AgentBadgeProps) {
  const message = useMessage();
  const isAgent = () => isAgentSenderId(message().sender_id);

  return (
    <Show when={isAgent()}>
      <AgentTag class={props.class} />
    </Show>
  );
}
