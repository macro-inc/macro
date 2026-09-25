import { firstPartyBotMark } from '@core/component/firstPartyBotMark';
import { UserIcon } from '@core/component/UserIcon';
import { senderFromStorageId } from '@queries/messages/message-sender';
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

  // Team bots render their uploaded avatar; first-party bots have none and
  // keep their brand mark, which UserIcon draws the same way the mention menu
  // does.
  const botSender = (): ApiMessageSender | undefined => {
    const sender = message().sender ?? senderFromStorageId(message().sender_id);
    if (sender.type !== 'bot' || firstPartyBotMark(sender.id)) return undefined;
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
