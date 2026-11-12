import type { UserIconProps } from '@core/component/UserIcon';
import { Avatar } from '@ui';

/** Keep real avatar geometry without loading account data in the isolated fixture. */
export function UserIcon(
  props: Pick<UserIconProps, 'size' | 'class' | 'name'>
) {
  return (
    <Avatar size={props.size} class={props.class}>
      <Avatar.Fallback>{props.name?.slice(0, 1) ?? 'U'}</Avatar.Fallback>
    </Avatar>
  );
}
