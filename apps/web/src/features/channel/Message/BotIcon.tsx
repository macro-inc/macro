import { staticFileSizedUrl } from '@core/constant/servers';
import { Avatar, type AvatarSize } from '@ui';
import { Show } from 'solid-js';

type BotIconProps = {
  /** Bot display name, used for the fallback initial. */
  name?: string | null;
  /** Bot avatar URL. */
  avatarUrl?: string | null;
  size?: AvatarSize;
  class?: string;
};

/**
 * Bot avatar: the bot's avatar image with an initial fallback. Unlike
 * `UserIcon`, it carries no DM-on-click or user tooltip behavior since
 * those only make sense for people.
 */
export function BotIcon(props: BotIconProps) {
  const initial = () => props.name?.trim().charAt(0).toUpperCase() || 'B';

  return (
    <Avatar size={props.size ?? 'md'} class={props.class}>
      <Show
        when={props.avatarUrl}
        fallback={
          <Avatar.Fallback class="font-semibold">{initial()}</Avatar.Fallback>
        }
        keyed
      >
        {(url) => {
          // Fall back from the sized URL to the original at most once, so a
          // broken original doesn't retrigger onError in a loop.
          let triedFallback = false;
          return (
            <Avatar.Image
              // Solid surface circle behind the picture so a transparent avatar
              // shows surface color rather than what's behind it.
              class="bg-surface"
              src={staticFileSizedUrl(url, 'small')}
              alt={props.name ?? 'Bot'}
              onError={(e) => {
                if (!triedFallback) {
                  triedFallback = true;
                  e.currentTarget.src = url;
                }
              }}
            />
          );
        }}
      </Show>
    </Avatar>
  );
}
