import User from '@phosphor-icons/core/regular/user.svg?component-solid';
import { type Component } from 'solid-js';
import type { UserIconProps } from '@core/component/UserIcon';
import { cn } from '@ui/utils/classname';

/** Matches `UserIcon` outer ring + Phosphor user silhouette. */
export function inCallAvatarPlaceholderClasses(size: UserIconProps['size']) {
  const s = size ?? 'md';
  const container = cn(
    'shrink-0 rounded-full bg-ink-extra-muted text-panel flex items-center justify-center',
    s === 'xs' && 'size-4',
    s === 'sm' && 'size-6',
    s === 'md' && 'size-8',
    s === 'lg' && 'size-10',
    s === 'xl' && 'size-25',
    s === 'fill' && 'size-8 w-full h-full'
  );
  const icon = cn(
    s === 'xs' && 'w-2 h-2',
    s === 'sm' && 'w-3 h-3',
    s === 'md' && 'w-4 h-4',
    s === 'lg' && 'w-5 h-5',
    s === 'xl' && 'w-16 h-16',
    s === 'fill' && 'w-4 h-4'
  );
  return { container, icon };
}

export const InCallAvatarPlaceholderShell: Component<{
  size?: UserIconProps['size'];
}> = (props) => {
  const classes = () => inCallAvatarPlaceholderClasses(props.size);
  return (
    <div class={classes().container} data-in-call-panel-avatar-placeholder>
      <User class={classes().icon} aria-hidden />
    </div>
  );
};
