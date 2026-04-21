import User from '@phosphor-icons/core/regular/user.svg?component-solid';
import DotsThree from '@icon/regular/dots-three.svg';
import { Show, type Component } from 'solid-js';
import type { UserIconProps } from '@core/component/UserIcon';
import { cn } from '@ui/utils/classname';

export function inCallAvatarPlaceholderClasses(size: UserIconProps['size']) {
  const s = size ?? 'md';
  const container = cn(
    'flex shrink-0 items-center justify-center rounded-full bg-ink-extra-muted text-panel leading-none',
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
  variant?: 'placeholder' | 'view-more';
}> = (props) => {
  const classes = () => inCallAvatarPlaceholderClasses(props.size);
  return (
    <div
      class={cn(
        classes().container,
        props.variant === 'view-more' &&
          'bg-transparent border-2 border-accent/70 rounded-full'
      )}
    >
      <Show when={props.variant === 'placeholder'}>
        <User class={cn(classes().icon, 'block')} aria-hidden />
      </Show>

      <Show when={props.variant === 'view-more'}>
        <DotsThree
          class="block h-6 w-6 bg-transparent text-accent"
          aria-hidden
        />
      </Show>
    </div>
  );
};
