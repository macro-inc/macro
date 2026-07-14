import RobotIcon from '@phosphor/robot.svg';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Avatar } from '@ui';
import { Show } from 'solid-js';

export function BotAvatar(props: {
  bot: Pick<Bot, 'name' | 'avatar_url'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Avatar size={props.size ?? 'md'}>
      <Show
        when={props.bot.avatar_url}
        fallback={
          <Avatar.Fallback>
            <RobotIcon class="size-4" />
          </Avatar.Fallback>
        }
      >
        {(avatarUrl) => <Avatar.Image src={avatarUrl()} alt={props.bot.name} />}
      </Show>
    </Avatar>
  );
}
