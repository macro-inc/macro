import ArrowUp from '@phosphor/arrow-up.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { children, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

export type SendButtonProps = Omit<ButtonProps, 'size' | 'variant'> & {
  /** Show a spinner instead of the arrow (e.g. while a send mutation is in-flight). */
  pending?: boolean;
  /** Fade the button to fully transparent — used to hide on mobile when the input is empty. */
  hidden?: boolean;
};

export function SendButton(props: SendButtonProps) {
  const [local, rest] = splitProps(props, [
    'pending',
    'hidden',
    'class',
    'children',
    'aria-label',
    'tooltip',
  ]);
  const resolved = children(() => local.children);

  return (
    <Button
      depth={5}
      variant="cta"
      size="icon-sm"
      draggable={false}
      aria-label={local['aria-label'] ?? 'Send'}
      tooltip={local.tooltip ?? 'Send'}
      class={cn(
        'rounded-[11px] size-7.5 [&_svg]:stroke-[4px]',
        'transition-transform ease duration-150',
        'data-disabled:opacity-100 data-disabled:text-ink-extra-muted! data-disabled:bg-ink-muted/5',
        'active:not-disabled:scale-95',
        local.hidden && 'opacity-0!',
        local.class
      )}
      {...rest}
    >
      <Show when={!local.pending} fallback={<SpinnerIcon class="animate-spin" />}>
        {resolved() ?? <ArrowUp />}
      </Show>
    </Button>
  );
}
