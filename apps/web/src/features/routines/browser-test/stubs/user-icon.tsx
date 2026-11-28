import { Avatar } from '@ui';
import type { ComponentProps } from 'solid-js';

/** A person's avatar at the app's size, from their initials alone. */
export function UserIcon(props: {
  id?: string;
  size?: ComponentProps<typeof Avatar>['size'];
}) {
  return (
    <Avatar size={props.size}>
      <Avatar.Fallback class="font-semibold">AQ</Avatar.Fallback>
    </Avatar>
  );
}
