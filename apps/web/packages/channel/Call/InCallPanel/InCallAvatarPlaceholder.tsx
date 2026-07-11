import type { UserIconProps } from '@core/component/UserIcon';
import DotsThree from '@phosphor/dots-three.svg';
import User from '@phosphor-icons/core/regular/user.svg?component-solid';
import { cn } from '@ui';
import { type Component, Show } from 'solid-js';

export function inCallAvatarPlaceholderClasses(size: UserIconProps['size']) {
  const s = size ?? 'sm';
  const container = cn(
    'flex shrink-0 items-center justify-center rounded-full bg-ink-extra-muted text-surface leading-none',
    s === 'sm' && 'size-4',
    s === 'md' && 'size-6',
    s === 'lg' && 'size-10',
    s === 'fill' && 'size-full'
  );
  const icon = cn(
    s === 'sm' && 'size-2',
    s === 'md' && 'size-3',
    s === 'lg' && 'size-5',
    s === 'fill' && 'size-4'
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
          class="block size-6 bg-transparent text-accent"
          aria-hidden
        />
      </Show>
    </div>
  );
};
