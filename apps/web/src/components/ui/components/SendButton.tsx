import ArrowUp from '@phosphor/arrow-up.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { children, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

export type SendButtonProps = Omit<ButtonProps, 'size' | 'variant'> & {
  appearance?: 'default' | 'composer';
  /** Show a spinner instead of the arrow (e.g. while a send mutation is in-flight). */
  pending?: boolean;
  /** Fade the button to fully transparent — used to hide on mobile when the input is empty. */
  hidden?: boolean;
};

export function SendButton(props: SendButtonProps) {
  const [local, rest] = splitProps(props, [
    'pending',
    'appearance',
    'hidden',
    'class',
    'children',
    'aria-label',
    'tooltip',
  ]);
  const resolved = children(() => local.children);

  return (
    <Button
      depth={4}
      variant="strong"
      size={local.appearance === 'composer' ? 'icon-composer' : 'icon-sm'}
      draggable={false}
      aria-label={local['aria-label'] ?? 'Send'}
      tooltip={local.tooltip ?? 'Send'}
      class={cn(
        'rounded-full touch:size-7.5',
        local.appearance === 'composer'
          ? 'not-touch:not-disabled:bg-composer-action not-touch:not-disabled:text-composer-action-ink not-touch:light-mode:shadow-none not-touch:light-mode:backdrop-filter-none not-touch:light-mode:after:hidden'
          : 'size-7',
        '[&_svg]:stroke-[4px]',
        'transition-transform ease-in-out duration-150',
        'data-disabled:opacity-100 data-disabled:text-ink-extra-muted! data-disabled:bg-ink-muted/5',
        'active:not-disabled:scale-95',
        local.hidden && 'opacity-0!',
        local.class
      )}
      {...rest}
    >
      <Show
        when={!local.pending}
        fallback={<SpinnerIcon class="animate-spin" />}
      >
        {resolved() ?? <ArrowUp />}
      </Show>
    </Button>
  );
}
