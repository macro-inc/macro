import { tryMacroId, useDisplayName } from '@core/user';
import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { MACRO_AI_BOT_ID, MACRO_AI_NAME } from '../macroAi';
import { useMessage } from './context';

type SenderNameProps = {
  class?: string;
  hidden?: boolean;
};

/** Resolve a bot sender's display name, or `undefined` for user senders. */
function botName(
  senderId: string,
  sender: ApiMessageSender | undefined
): string | undefined {
  const parsed = sender ?? senderFromStorageId(senderId);
  if (parsed.type !== 'bot') return undefined;
  if (parsed.name) return parsed.name;
  return parsed.id === MACRO_AI_BOT_ID ? MACRO_AI_NAME : 'Bot';
}

export function SenderName(props: SenderNameProps) {
  const message = useMessage();
  const macroId = () => tryMacroId(message().sender_id);
  const [displayName] = useDisplayName(macroId());
  const agentName = () => botName(message().sender_id, message().sender);

  return (
    <Show when={!props.hidden}>
      <span class={cn('text-sm font-medium truncate', props.class)}>
        {agentName() ?? displayName()}
      </span>
    </Show>
  );
}
