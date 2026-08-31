import { focusInput } from '@core/directive/focusInput';
import IconPlus from '@phosphor/plus.svg';
import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';

type ThreadReplyButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  getFocusTarget?: () => HTMLElement | null | undefined;
};

export function ThreadReplyButton(props: ThreadReplyButtonProps) {
  const [local, rest] = splitProps(props, ['class', 'getFocusTarget']);

  return (
    <button
      type="button"
      class={cn(
        'rounded-full icon-plus mb-2 border border-thread-rail bg-surface hover:bg-hover flex flex-row justify-center items-center size-8 touch:min-h-(--user-icon-width) touch:min-w-(--user-icon-width) text-ink-muted hover:text-ink',
        local.class
      )}
      ref={(el) => {
        const getTarget = local.getFocusTarget;
        if (getTarget) focusInput(el, () => ({ getTarget }));
      }}
      {...rest}
    >
      <IconPlus class="size-4" />
    </button>
  );
}
