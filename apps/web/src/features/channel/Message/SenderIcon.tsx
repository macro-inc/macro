import { firstPartyBotMark } from '@core/component/firstPartyBotMark';
import { UserCardTrigger } from '@core/component/UserCardTrigger';
import { UserIcon } from '@core/component/UserIcon';
import type { UserCardTarget } from '@core/component/userCardActions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  getBotDisplayName,
  senderFromStorageId,
} from '@queries/messages/message-sender';
import type { MessageSender } from '@service-storage/messages';
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

  const sender = (): MessageSender =>
    message().sender ?? senderFromStorageId(message().sender_id);

  // Team bots render their uploaded avatar; first-party bots have none and
  // keep their brand mark, which UserIcon draws the same way the mention menu
  // does.
  const botSender = (): MessageSender | undefined => {
    const current = sender();
    if (current.type !== 'bot' || firstPartyBotMark(current.id)) {
      return undefined;
    }
    return current;
  };

  // Someone outside Macro, such as a WhatsApp participant, has no principal.
  const externalAuthor = () => {
    const name = message().imported_author?.name?.trim();
    return !message().sender_id && name
      ? { name, avatar_url: null }
      : undefined;
  };

  // An agent's avatar hovers like a person's, with the card that leads to its
  // settings. UserIcon gives people that card but draws bots without one.
  const agentCard = (): UserCardTarget | undefined => {
    const current = sender();
    if (message().guest_name || current.type !== 'bot') return undefined;
    return {
      displayName:
        getBotDisplayName(message().sender_id, current) ?? current.id,
      id: message().sender_id,
      photoUrl: current.avatar_url ?? undefined,
    };
  };

  const avatar = () => (
    <Show
      when={
        message().guest_name
          ? { name: message().guest_name, avatar_url: null }
          : (externalAuthor() ?? botSender())
      }
      fallback={<UserIcon id={message().sender_id} size="fill" />}
    >
      {(bot) => (
        <BotIcon name={bot().name} avatarUrl={bot().avatar_url} size="fill" />
      )}
    </Show>
  );

  return (
    <div
      class={cn('shrink-0 size-(--user-icon-width)', props.class, {
        invisible: props.hidden,
      })}
      aria-hidden={props.hidden ? 'true' : undefined}
    >
      {!props.hidden && (
        <Show when={agentCard()} fallback={avatar()}>
          {(user) => (
            <UserCardTrigger
              placement="left"
              triggerAs="div"
              triggerClass="size-full"
              triggerTabIndex={isTouchDevice() ? 0 : -1}
              user={user()}
              trigger={avatar()}
            />
          )}
        </Show>
      )}
    </div>
  );
}
