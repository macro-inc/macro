import { t } from '@app/lib/i18n';
import type { MessageData } from '@core/messages/types';
import { getDisplayName, tryMacroId } from '@core/user';
import { useLiveBotSender } from '@queries/bots/profiles';
import {
  getBotDisplayName,
  isUnverifiedClientSender,
  senderFromStorageId,
} from '@queries/messages/message-sender';
import { cn, Tooltip } from '@ui';
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

export function SenderName(props: { message: MessageData }) {
  // An unverified client keeps its chosen name, marked so it can't pass for
  // the product it names; the suffix explains itself on hover and to screen
  // readers, and stays visible where tooltips don't open (touch).
  const unverifiedClient = () => {
    const sender = props.message.sender;
    return !props.message.guest_name &&
      sender &&
      sender.triggered_via &&
      isUnverifiedClientSender(sender)
      ? sender.triggered_via
      : undefined;
  };
  const macroId = () => tryMacroId(props.message.sender_id);
  const displayName = () => getDisplayName(macroId());
  const sender = useLiveBotSender(
    () => props.message.sender ?? senderFromStorageId(props.message.sender_id)
  );
  const agentName = () => getBotDisplayName(props.message.sender_id, sender());
  const importedName = () => {
    const name = props.message.imported_author?.name?.trim();
    return name ? name : undefined;
  };
  return (
    <Show
      when={unverifiedClient()}
      fallback={
        props.message.guest_name
          ? `${props.message.guest_name} (Guest)`
          : (importedName() ?? agentName() ?? displayName())
      }
    >
      {(name) => (
        <>
          {name()}{' '}
          <Tooltip
            as="span"
            label={t('mcpClients.unverifiedExplanation', { name: name() })}
          >
            <span
              class="font-normal text-ink-muted"
              aria-description={t('mcpClients.unverifiedExplanation', {
                name: name(),
              })}
            >
              {t('mcpClients.unverifiedSuffix')}
            </span>
          </Tooltip>
        </>
      )}
    </Show>
  );
}
