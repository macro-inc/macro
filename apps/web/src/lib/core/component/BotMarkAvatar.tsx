import { Avatar, type AvatarSize, cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import {
  type FirstPartyBotMark,
  firstPartyBotMarkTone,
} from './firstPartyBotMark';

/** A brand mark drawn as an avatar, for bots and clients the client ships a mark for. */
export function BotMarkAvatar(props: {
  mark: FirstPartyBotMark;
  size: AvatarSize;
  class?: string;
}) {
  return (
    <Avatar
      size={props.size}
      class={cn(
        'bg-surface ring ring-edge-muted',
        firstPartyBotMarkTone(props.mark),
        props.class
      )}
    >
      <Avatar.Fallback>
        <Dynamic component={props.mark.Icon} class="size-[62%]" />
      </Avatar.Fallback>
    </Avatar>
  );
}
