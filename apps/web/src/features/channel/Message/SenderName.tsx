import type { MessageData } from '@core/messages/types';
import { getDisplayName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

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

/** External attribution never represents a signed-in Macro teammate. */
export function ExternalBadge() {
  const message = useMessage();
  return (
    <Show when={message().sender_id.startsWith('external|')}>
      <span
        class="shrink-0 rounded px-1 text-xs text-ink-muted ring ring-edge-muted"
        title="Sent from a connected external account"
      >
        External
      </span>
    </Show>
  );
}

export function SenderName(props: { message: MessageData }) {
  const macroId = () => tryMacroId(props.message.sender_id);
  const displayName = () => getDisplayName(macroId());
  const agentName = () =>
    getBotDisplayName(props.message.sender_id, props.message.sender);
  const importedName = () =>
    props.message.imported_author?.name?.trim() || undefined;
  return <>{importedName() ?? agentName() ?? displayName()}</>;
}
