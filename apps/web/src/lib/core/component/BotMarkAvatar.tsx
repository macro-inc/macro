import { Avatar, type AvatarSize, cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import {
  type FirstPartyBotMark,
  firstPartyBotMarkTone,
} from './firstPartyBotMark';

/** An agent's avatar drawn as a product's brand mark. */
export function BotMarkAvatar(props: {
  mark: FirstPartyBotMark;
  size?: AvatarSize;
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
