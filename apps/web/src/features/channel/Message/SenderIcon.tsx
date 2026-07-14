import { UserIcon } from '@core/component/UserIcon';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { BotIcon } from './BotIcon';
import { useMessage } from './context';

type SenderIconProps = {
  class?: string;
  hidden?: boolean;
};

export function SenderIcon(props: SenderIconProps) {
  const message = useMessage();

  // Bot senders render their own avatar; Macro AI keeps its dedicated logo
  // rendering inside UserIcon.
  const botSender = (): ApiMessageSender | undefined => {
    const sender = message().sender ?? senderFromStorageId(message().sender_id);
    if (sender.type !== 'bot' || isMacroAgentId(sender.id)) return undefined;
    return sender;
  };

  return (
    <div
      class={cn('shrink-0 size-(--user-icon-width)', props.class, {
        invisible: props.hidden,
      })}
      aria-hidden={props.hidden ? 'true' : undefined}
    >
      {!props.hidden && (
        <Show
          when={botSender()}
          fallback={<UserIcon id={message().sender_id} size="fill" />}
        >
          {(bot) => (
            <BotIcon
              name={bot().name}
              avatarUrl={bot().avatar_url}
              size="fill"
            />
          )}
        </Show>
      )}
    </div>
  );
}
