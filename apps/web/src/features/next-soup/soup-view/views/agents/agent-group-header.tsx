import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import { cn, Layer } from '@ui';
import type { AgentAttentionState } from './agent-attention';

/**
 * Per-bucket tinting, mirroring the task status header's approach: the
 * urgent buckets get a warmer wash so they read at a glance.
 */
const ATTENTION_GROUP_HEADER_TINTS: Record<AgentAttentionState, string> = {
  needs_approval:
    'bg-alert/5 border-alert/10 data-highlighted:bg-alert/10 hover:bg-alert/10',
  running:
    'bg-accent/5 border-accent/10 data-highlighted:bg-accent/10 hover:bg-accent/10',
  pr_ready:
    'bg-note/5 border-note/10 data-highlighted:bg-note/10 hover:bg-note/10',
  past: 'bg-ink/5 border-ink/10 data-highlighted:bg-ink/10 hover:bg-ink/10',
};

/** Group header for the Agents view's attention buckets. */
export const AgentGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  const tint = () =>
    ATTENTION_GROUP_HEADER_TINTS[props.group.key as AgentAttentionState];

  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
      class={tint()}
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
