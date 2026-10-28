import ArrowUp from '@icon/system/bold/arrow-up-bold.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { children, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

export type SendButtonProps = Omit<
  ButtonProps,
  'size' | 'variant' | 'appearance'
> & {
  appearance?: 'default' | 'composer';
  /**
   * Empty composer with a queue waiting: the same send control, ringed so it
   * reads as flushing that queue rather than sending a new message.
   */
  intent?: 'send' | 'flush';
  /** Show a spinner instead of the arrow (e.g. while a send mutation is in-flight). */
  pending?: boolean;
  /** Drop the button from the layout — used to hide on mobile when the input is empty. */
  hidden?: boolean;
  /** Visible desktop action text; touch surfaces retain the compact icon. */
  actionLabel?: string;
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
    'actionLabel',
    'intent',
  ]);
  const resolved = children(() => local.children);

  return (
    <Button
      variant="neutral"
      size="icon-md"
      draggable={false}
      aria-label={
        local['aria-label'] ??
        (local.intent === 'flush' ? 'Flush queued messages' : 'Send')
      }
      tooltip={
        local.tooltip ??
        (local.intent === 'flush' ? 'Flush queued messages' : 'Send')
      }
      data-intent={local.intent === 'flush' ? 'flush' : undefined}
      class={cn(
        'border-0',
        local.intent === 'flush' && 'ring-2 ring-accent/60',
        local.appearance === 'composer' &&
          local.actionLabel &&
          'not-touch:w-auto! not-touch:aspect-auto! not-touch:px-3 not-touch:gap-1.5',
        'transition-transform ease-in-out duration-150',
        'data-disabled:opacity-100 data-disabled:text-ink-extra-muted! data-disabled:bg-ink-muted/5',
        'active:not-disabled:scale-95',
        // Out of the flow, not just invisible: a transparent send button
        // holds its slot and strands whatever sits before it well short of
        // the composer's edge.
        local.hidden && 'hidden',
        local.class
      )}
      {...rest}
    >
      <Show
        when={!local.pending}
        fallback={
          <SpinnerIcon class="size-5 shrink-0 animate-spin touch:size-6" />
        }
      >
        {resolved() ?? (
          <>
            <ArrowUp class="size-5 shrink-0 touch:size-6" />
            <Show when={local.actionLabel}>
              <span class="hidden whitespace-nowrap text-sm font-medium not-touch:inline">
                {local.actionLabel}
              </span>
            </Show>
          </>
        )}
      </Show>
    </Button>
  );
}
