import { getDisplayName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/channel/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';
import type { MessageData } from './types';

type SenderNameProps = {
  class?: string;
  hidden?: boolean;
};

export function MessageSenderName(props: SenderNameProps) {
  const message = useMessage();

  return (
    <Show when={!props.hidden}>
      <span class={cn('text-sm font-medium truncate', props.class)}>
        <SenderName message={message()} />
      </span>
    </Show>
  );
}

export function SenderName(props: { message: MessageData }) {
  const macroId = () => tryMacroId(props.message.sender_id);
  const displayName = () => getDisplayName(macroId());
  const agentName = () =>
    getBotDisplayName(props.message.sender_id, props.message.sender);
  return <>{agentName() ?? displayName()}</>;
}
