import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import { cn, Layer } from '@ui';
import type { AgentAttentionState } from '@entity/utils/agent-attention';

/** Per-bucket tinting: urgency reads at a glance, like task statuses do. */
const ATTENTION_GROUP_HEADER_TINTS: Record<AgentAttentionState, string> = {
  needs_approval:
    'bg-alert/5 border-alert/10 data-highlighted:bg-alert/10 hover:bg-alert/10',
  running:
    'bg-accent/5 border-accent/10 data-highlighted:bg-accent/10 hover:bg-accent/10',
  pr_ready:
    'bg-note/5 border-note/10 data-highlighted:bg-note/10 hover:bg-note/10',
  past: 'bg-ink/5 border-ink/10 data-highlighted:bg-ink/10 hover:bg-ink/10',
};

const tintFor = (key: string): string | undefined =>
  ATTENTION_GROUP_HEADER_TINTS[key as AgentAttentionState];

export const AgentGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
      class={tintFor(props.group.key)}
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
      <span
        class={cn(
          'shrink-0 tabular-nums text-xs font-medium',
          'px-1.5 py-px rounded-full bg-ink/10 text-ink-extra-muted'
        )}
      >
        {props.group.count}
      </span>
    </SoupSectionHeader>
  );
};
