import IconPlus from '@icon/regular/plus.svg';
import { cn } from '@ui/utils/classname';
import { splitProps, type JSX } from 'solid-js';

type ThreadReplyButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export function ThreadReplyButton(props: ThreadReplyButtonProps) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <button
      type="button"
      class={cn(
        'w-min icon-plus allow-css-brackets mb-2 border border-edge-muted bg-menu hover:bg-hover hover-transition-bg flex flex-row justify-center items-center size-[var(--user-icon-width)] touch:min-h-[var(--user-icon-width)] touch:min-w-[var(--user-icon-width)] text-ink-muted',
        local.class
      )}
      {...rest}
    >
      <IconPlus class="size-1/2" />
    </button>
  );
}
