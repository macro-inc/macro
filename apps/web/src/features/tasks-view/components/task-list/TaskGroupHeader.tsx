import type { SoupGroupHeaderRow } from '@app/features/soup';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import { getPropertyOptionLabel } from '@entity';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import { PROPERTY_OPTION_IDS } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { cn, Layer, Surface } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import type { TaskGroupBy } from '../../types';

const STATUS_GROUP_HEADER_TINTS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]:
    'bg-task/5 border-task/10 data-highlighted:bg-task/10 hover:bg-task/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]:
    'bg-alert/5 border-alert/10 data-highlighted:bg-alert/10 hover:bg-alert/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]:
    'bg-note/5 border-note/10 data-highlighted:bg-note/10 hover:bg-note/10',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]:
    'bg-accent/5 border-accent/10 data-highlighted:bg-accent/10 hover:bg-accent/10',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]:
    'bg-ink/5 border-ink/10 data-highlighted:bg-ink/10 hover:bg-ink/10',
};

export function TaskGroupHeader(props: {
  row: SoupGroupHeaderRow;
  groupBy: TaskGroupBy;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  const label = createMemo(() => {
    if (!props.row.groupId) return props.row.label || 'Not set';

    if (props.groupBy === 'status' || props.groupBy === 'priority') {
      return getPropertyOptionLabel(props.row.groupId) ?? props.row.label;
    }

    if (props.groupBy === 'assignee') {
      const assigneeId = tryMacroId(props.row.groupId);
      if (!assigneeId) return props.row.label;
      return (
        getDisplayName(assigneeId, { emailFallback: 'local-part' }) ||
        props.row.label
      );
    }

    return props.row.label;
  });
  const statusTint = createMemo(() =>
    props.groupBy === 'status'
      ? STATUS_GROUP_HEADER_TINTS[props.row.groupId]
      : undefined
  );

  return (
    <div id={props.row.id} role="row">
      <div role="gridcell" aria-colspan={7}>
        <Surface
          depth={3}
          hideBorder
          data-highlighted={props.focused || undefined}
          class={cn(
            'group/header mx-1 my-0.5 h-auto w-[calc(100%-0.5rem)] rounded-lg border border-edge-muted text-ink-muted hover:bg-active',
            statusTint(),
            props.focused && 'bg-active'
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            class="flex w-full items-center gap-2.5 rounded-[inherit] px-2 py-1.5 text-left text-xs font-semibold tracking-tight"
            aria-expanded={props.expanded}
            onMouseMove={props.onFocus}
            onClick={props.onToggle}
          >
            <Layer depth={3}>
              <span class="flex size-4.5 items-center justify-center rounded-xs group-hover/header:bg-ink/5">
                <CaretRightIcon
                  class={cn(
                    'size-2.5 transition-transform',
                    props.expanded && 'rotate-90'
                  )}
                />
              </span>
            </Layer>
            <Switch>
              <Match when={!props.row.groupId}>
                <CircleDashedIcon class="size-3.5 text-ink-extra-muted" />
              </Match>
              <Match
                when={
                  props.groupBy === 'status' || props.groupBy === 'priority'
                }
              >
                <PropertyValueIcon
                  optionId={props.row.groupId}
                  class="size-3.5"
                />
              </Match>
              <Match when={props.groupBy === 'assignee'}>
                <UserIcon
                  id={props.row.groupId}
                  size="sm"
                  suppressClick
                  showTooltip={false}
                />
              </Match>
              <Match when={props.groupBy === 'project'}>
                <FolderIcon class="size-3.5 shrink-0" />
              </Match>
            </Switch>
            <span class="truncate">{label()}</span>
            <Show when={props.row.count !== undefined}>
              <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                {props.row.count}
              </span>
            </Show>
          </button>
        </Surface>
      </div>
    </div>
  );
}
