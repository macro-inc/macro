import { BotIcon } from '@channel/Message/BotIcon';
import { firstPartyBotMark } from '@core/component/firstPartyBotMark';
import { UserIcon } from '@core/component/UserIcon';
import type { AvatarSize } from '@ui';
import { Show } from 'solid-js';

/** Persona avatar without a person's profile card or human DM action. */
export function PersonaAvatar(props: {
  botId: string;
  name: string;
  avatarUrl?: string | null;
  class?: string;
  size?: AvatarSize;
}) {
  return (
    <Show
      when={firstPartyBotMark(props.botId)}
      fallback={
        <BotIcon
          name={props.name}
          avatarUrl={props.avatarUrl}
          size={props.size}
          class={props.class}
        />
      }
    >
      <UserIcon
        id={`bot|${props.botId}`}
        size={props.size ?? 'md'}
        class={props.class}
        suppressClick
        showTooltip={false}
      />
    </Show>
  );
}
