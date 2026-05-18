import { focusInput } from '@core/directive/focusInput';
import IconPlus from '@icon/regular/plus.svg';
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
        'w-min rounded icon-plus mb-2 border border-edge-muted bg-surface hover:bg-hover hover-transition-bg flex flex-row justify-center items-center size-(--user-icon-width) touch:min-h-(--user-icon-width) touch:min-w-(--user-icon-width) text-ink-muted',
        local.class
      )}
      ref={(el) => {
        const getTarget = local.getFocusTarget;
        if (getTarget) focusInput(el, () => ({ getTarget }));
      }}
      {...rest}
    >
      <IconPlus class="size-1/2" />
    </button>
  );
}
