import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';

/** Airier group divider used only by experimental list compositions. */
export function ExperimentalGroupHeader(
  props: GroupHeaderProps & { highlighted?: boolean }
) {
  return (
    <button
      type="button"
      class={cn(
        'group mx-3 flex w-[calc(100%-1.5rem)] items-center gap-2 px-2 pb-2 pt-5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted outline-none',
        props.highlighted && 'text-ink'
      )}
      onClick={() => props.group.toggle()}
    >
      <span class="flex size-5 items-center justify-center rounded-md bg-ink/5 text-ink-muted transition-colors group-hover:bg-ink/8 group-hover:text-ink">
        <CaretRightIcon
          class={cn('size-3 transition-transform', {
            'rotate-90': props.group.isExpanded(),
          })}
        />
      </span>
      <span class="truncate">{props.group.label}</span>
      <span class="h-px min-w-4 flex-1 bg-edge-muted/80" />
      <span class="shrink-0 tabular-nums font-medium text-ink-extra-muted">
        {props.group.count}
      </span>
    </button>
  );
}
