import { staticFileSizedUrl } from '@core/constant/servers';
import { Avatar, type AvatarSize } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * A person's or group's picture at the provider, over `children` (initials
 * or an icon), which show while it loads, when there is none, or when it
 * fails. Decorative: its name is always shown beside it. Loads the small
 * preview, like `BotIcon`, falling back once to the original.
 */
export function ProviderPicture(props: {
  url?: string;
  size: AvatarSize;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Avatar size={props.size} class={props.class}>
      <Avatar.Fallback class="size-full">{props.children}</Avatar.Fallback>
      <Show when={props.url} keyed>
        {(url) => {
          let triedOriginal = false;
          return (
            <Avatar.Image
              class="bg-surface"
              src={staticFileSizedUrl(url, 'small')}
              alt=""
              data-provider-picture
              onError={(event) => {
                if (!triedOriginal) {
                  triedOriginal = true;
                  event.currentTarget.src = url;
                }
              }}
            />
          );
        }}
      </Show>
    </Avatar>
  );
}
