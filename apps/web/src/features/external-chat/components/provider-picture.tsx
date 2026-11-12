import { Avatar, type AvatarSize } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * A person's or group's picture at the provider, over `children` (initials
 * or an icon), which show while it loads, when there is none, or when it
 * fails. Provider pictures are small previews, so no sized variant.
 */
export function ProviderPicture(props: {
  name: string;
  url?: string;
  size: AvatarSize;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Avatar size={props.size} class={props.class}>
      <Avatar.Fallback class="size-full">{props.children}</Avatar.Fallback>
      <Show when={props.url}>
        {(url) => (
          <Avatar.Image
            class="bg-surface"
            src={url()}
            alt={props.name}
            data-provider-picture
          />
        )}
      </Show>
    </Avatar>
  );
}
