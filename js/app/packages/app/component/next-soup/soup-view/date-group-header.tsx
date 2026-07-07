import type { GroupHeaderProps } from '@app/component/next-soup/create-soup-state';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';

export const DateGroupHeader = (props: GroupHeaderProps) => {
  return (
    <button
      type="button"
      onClick={() => props.group.toggle()}
      class="flex w-full items-center gap-1.5 px-4 py-4 text-sm font-medium text-ink-extra-muted hover:bg-active data-highlighted:bg-active"
      data-highlighted={props.highlighted || undefined}
    >
      <ChevronRightIcon
        class={cn('size-4 shrink-0 transition-transform', {
          'rotate-90': props.group.isExpanded(),
        })}
      />
      <span class="truncate">{props.group.label}</span>
    </button>
  );
};
