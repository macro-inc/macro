import type { SoupGroupHeaderRow } from '@app/features/soup';
import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import { getPropertyOptionLabel } from '@entity';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ProjectIcon from '@icon/system/regular/stack.svg';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { PropertyEmptyIcon } from '@property/extractors/PropertyEmpty';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import { ComposerSurface, cn, Layer } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import type { TaskGroupBy } from '../../types';

const EMPTY_GROUP_PROPERTY_IDS: Partial<Record<TaskGroupBy, string>> = {
  priority: SYSTEM_PROPERTY_IDS.PRIORITY,
  project: SYSTEM_PROPERTY_IDS.PROJECT,
  assignee: SYSTEM_PROPERTY_IDS.ASSIGNEES,
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
  const alignWithRows = () => isWide() && !isMobile();
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
        {/* Desktop shares the email card's composer chrome: soft shadow in
            light mode, glass rim in dark mode. */}
        <Layer depth={3}>
          <ComposerSurface
            as="div"
            data-highlighted={props.focused || undefined}
            class={cn(
              'group/header relative mr-1 my-0.5 w-[calc(100%-0.5rem)] rounded-xl text-ink-muted hover:bg-active',
              !isMobile() && 'ml-(--soup-row-gutter)',
              // Paint the touch border without shifting the shared row geometry.
              isTouchDevice() &&
                'rounded-lg border-edge-muted bg-surface after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-inherit',
              statusTint(),
              props.focused && 'bg-active'
            )}
          >
            <button
              type="button"
              tabIndex={-1}
              class={cn(
                'grid min-w-0 w-full items-center whitespace-nowrap rounded-[inherit] py-2 text-left text-xs font-semibold tracking-tight touch:min-h-11',
                alignWithRows()
                  ? 'grid-cols-[var(--soup-row-indicator-width)_minmax(0,1fr)] gap-x-(--soup-row-column-gap) pl-(--soup-row-padding-l) pr-3'
                  : 'grid-cols-[1rem_minmax(0,1fr)] gap-x-1 px-2'
              )}
              aria-expanded={props.expanded}
              onMouseMove={props.onFocus}
              onClick={props.onToggle}
            >
              <Layer depth={3}>
                <span class="flex size-full items-center justify-center rounded-xs group-hover/header:bg-ink/5">
                  <CaretRightIcon
                    class={cn(
                      'size-2.5 transition-transform',
                      props.expanded && 'rotate-90'
                    )}
                  />
                </span>
              </Layer>
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class={cn(
                    'flex h-4.5 shrink-0 items-center justify-center',
                    alignWithRows() ? 'w-6 touch:w-9' : 'w-4'
                  )}
                >
                  <Switch>
                    <Match when={!props.row.groupId}>
                      <PropertyEmptyIcon
                        propertyDefinitionId={
                          EMPTY_GROUP_PROPERTY_IDS[props.groupBy]
                        }
                        class="size-3.5 text-ink-extra-muted"
                      />
                    </Match>
                    <Match
                      when={
                        props.groupBy === 'status' ||
                        props.groupBy === 'priority'
                      }
                    >
                      <PropertyValueIcon
                        optionId={props.row.groupId}
                        class="size-4 shrink-0"
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
                <span class="truncate">{label()}</span>
                <Show when={props.row.count !== undefined}>
                  <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                    {props.row.count}
                  </span>
                </Show>
              </div>
            </button>
          </ComposerSurface>
        </Layer>
      </div>
    </div>
  );
}
