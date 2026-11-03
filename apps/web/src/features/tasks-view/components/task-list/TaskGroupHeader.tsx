import type { SoupGroupHeaderRow } from '@app/features/soup';
import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import { getPropertyOptionLabel } from '@entity';
import { ListGroupHeader } from '@entity/composed/list-entity/list-group-header';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import ProjectIcon from '@icon/system/regular/cube.svg';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { PropertyEmptyIcon } from '@property/extractors/PropertyEmpty';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import { cn } from '@ui';
import { createMemo, Match, Switch } from 'solid-js';
import type { TaskGroupBy } from '../../types';

export const EMPTY_GROUP_PROPERTY_IDS: Partial<Record<TaskGroupBy, string>> = {
  priority: SYSTEM_PROPERTY_IDS.PRIORITY,
  project: SYSTEM_PROPERTY_IDS.PROJECT,
  assignee: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  date: SYSTEM_PROPERTY_IDS.DUE_DATE,
};

export const STATUS_GROUP_HEADER_TINTS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]:
    'bg-task-status-not-started/5 border-task-status-not-started/10 data-highlighted:bg-task-status-not-started/10 hover:bg-task-status-not-started/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]:
    'bg-task-status-in-progress/5 border-task-status-in-progress/10 data-highlighted:bg-task-status-in-progress/10 hover:bg-task-status-in-progress/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]:
    'bg-task-status-in-review/5 border-task-status-in-review/10 data-highlighted:bg-task-status-in-review/10 hover:bg-task-status-in-review/10',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]:
    'bg-task-status-completed/5 border-task-status-completed/10 data-highlighted:bg-task-status-completed/10 hover:bg-task-status-completed/10',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]:
    'bg-task-status-canceled/5 border-task-status-canceled/10 data-highlighted:bg-task-status-canceled/10 hover:bg-task-status-canceled/10',
};

export function TaskGroupHeader(props: {
  row: SoupGroupHeaderRow;
  groupBy: TaskGroupBy;
  expanded: boolean;
  focused: boolean;
  /** Grid columns the header row spans. */
  columnCount: number;
  onToggle: () => void;
  onFocus: () => void;
}) {
  const isWide = useListLayout()?.isWide ?? (() => true);
  const agent = usePropertyUserDisplay(() =>
    props.groupBy === 'assignee' && isBotPrincipalId(props.row.groupId)
      ? props.row.groupId
      : ''
  );
  // The grouped page names a project group the viewer can read; a group still
  // labeled by its key resolves the name here.
  const unnamedProjectId = () =>
    props.groupBy === 'project' && props.row.label === props.row.groupId
      ? props.row.groupId
      : '';
  const project = usePropertyEntityDisplay(unnamedProjectId, () =>
    unnamedProjectId() ? 'INITIATIVE' : undefined
  );
  const label = createMemo(() => {
    if (!props.row.groupId) return props.row.label || 'Not set';

    if (props.groupBy === 'status' || props.groupBy === 'priority') {
      return getPropertyOptionLabel(props.row.groupId) ?? props.row.label;
    }

    if (props.groupBy === 'project') {
      return unnamedProjectId() ? project.name() : props.row.label;
    }

    if (props.groupBy === 'assignee') {
      if (isBotPrincipalId(props.row.groupId)) return agent.name();
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
    <div
      id={props.row.id}
      role="row"
      class={isWide() ? SOUP_ROW_CLASS.wide : SOUP_ROW_CLASS.narrow}
    >
      <div role="gridcell" aria-colspan={props.columnCount}>
        <ListGroupHeader
          label={label()}
          count={props.row.count}
          expanded={props.expanded}
          focused={props.focused}
          class={statusTint()}
          tabIndex={-1}
          onToggle={props.onToggle}
          onFocus={props.onFocus}
          icon={
            <span
              class={cn(
                'flex h-5 shrink-0 items-center justify-center',
                isMobile() ? 'w-5' : 'w-6 touch:w-9'
              )}
            >
              <Switch>
                <Match
                  when={
                    !props.row.groupId ||
                    (props.groupBy === 'date' &&
                      props.row.groupId === 'no_due_date')
                  }
                >
                  <PropertyEmptyIcon
                    propertyDefinitionId={
                      EMPTY_GROUP_PROPERTY_IDS[props.groupBy]
                    }
                    class={cn(
                      'size-3.5 text-ink-extra-muted',
                      props.groupBy === 'priority' && 'size-4'
                    )}
                  />
                </Match>
                <Match
                  when={
                    props.groupBy === 'status' || props.groupBy === 'priority'
                  }
                >
                  <PropertyValueIcon
                    optionId={props.row.groupId}
                    class="min-h-4 min-w-4 shrink-0"
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
                  <ProjectIcon class="size-3.5 shrink-0" />
                </Match>
              </Switch>
            </span>
          }
        />
      </div>
    </div>
  );
}
