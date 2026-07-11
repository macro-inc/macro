import type { GroupHeaderProps } from '@app/component/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/component/next-soup/soup-view/section-header';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import { cn, Layer } from '@ui';

export const DateGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
    >
      <Layer depth={3}>
        <div class="flex items-center justify-center size-4.5 rounded-xs group-hover/header:bg-ink/5">
          <ChevronRightIcon
            class={cn('size-2.5', {
              'rotate-90': props.group.isExpanded(),
            })}
          />
        </div>
      </Layer>

      <span class="truncate">{props.group.label}</span>
    </SoupSectionHeader>
  );
};
