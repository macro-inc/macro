import {
  TASK_GRID_COLUMNS,
  type TaskGridColumnId,
  taskGridTemplate,
} from '@app/features/tasks-view/components/task-list/task-grid-template';
import { t } from '@app/lib/i18n';
import '@app/features/tasks-view/components/task-list/task-list.css';
import './project-row.css';
import { EntityIcon } from '@core/component/EntityIcon';
import { Entity, MultiSelectCheckbox } from '@entity';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import TaskInProgressIcon from '@icon/system/regular/task-in-progress.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import PriorityHighIcon from '@icon/wide-priority-high.svg';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { Property, PropertyApiValues } from '@property/types';
import { cn, ProgressPill, Tooltip } from '@ui';
import { For, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ProjectRow as ProjectRowData } from '../context/projects-context';
import { canEditProject } from '../core/project';

// Projects reuse the task grid, including its single due-date column.
export const PROJECT_GRID_COLUMNS = [
  'indicator',
  'content',
  'status',
  'priority',
  'assignees',
  'dueDate',
  'createdBy',
  'timestamp',
] as const satisfies readonly TaskGridColumnId[];

/**
 * Touch lists projects on a phone or in a tablet's narrow list pane: no
 * header, no hover checkbox and none of the columns hidden at that width, as
 * the Tasks list does on phones, so the name gets the room they took.
 */
export const PROJECT_TOUCH_GRID_COLUMNS = [
  'content',
  'status',
  'priority',
  'assignees',
  'dueDate',
] as const satisfies readonly TaskGridColumnId[];

/** Below 840px the property columns are icon-wide, so their headings are too. */
const NARROW_HEADER_ICONS = {
  status: TaskInProgressIcon,
  priority: PriorityHighIcon,
  assignees: UsersIcon,
  dueDate: CalendarIcon,
};

type HeaderColumn = {
  area: string;
  label: string;
  narrowIcon?: typeof CalendarIcon;
};

const gridStyle = taskGridTemplate(PROJECT_GRID_COLUMNS);
const columns: HeaderColumn[] = [
  { area: 'content', label: 'Project' },
  ...TASK_GRID_COLUMNS.map((column) => ({
    area: column.id,
    label: column.label,
    narrowIcon: NARROW_HEADER_ICONS[column.id],
  })),
  { area: 'createdBy', label: 'Tasks' },
  { area: 'timestamp', label: 'Updated' },
];

export function ProjectListHeader() {
  return (
    <div
      role="row"
      class="task-grid-row project-grid-row grid h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={gridStyle}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <For each={columns}>
        {(column) => (
          <span
            role="columnheader"
            aria-label={column.label}
            style={{ 'grid-area': column.area }}
            class={cn(
              'flex min-w-0 items-center',
              column.narrowIcon && '@max-[840px]/u-list:justify-center',
              column.area === 'createdBy' && '@max-[1220px]/u-list:hidden',
              column.area === 'timestamp' &&
                'justify-end @max-[840px]/u-list:hidden'
            )}
          >
            <span
              class={cn(
                'truncate',
                column.narrowIcon && '@max-[840px]/u-list:hidden'
              )}
            >
              {column.label}
            </span>
            <Show when={column.narrowIcon}>
              {(icon) => (
                <span class="hidden @max-[840px]/u-list:inline-flex">
                  <Tooltip label={column.label} as="span" tabIndex={0}>
                    <Dynamic component={icon()} class="size-4" />
                  </Tooltip>
                </span>
              )}
            </Show>
          </span>
        )}
      </For>
    </div>
  );
}

/** Native initiative rows use the same grid and property cells as Tasks. */
export function ProjectRow(props: {
  rowId: string;
  row: ProjectRowData;
  columns: readonly TaskGridColumnId[];
  highlighted: boolean;
  checked: boolean;
  onFocus(): void;
  onOpen(event: MouseEvent): void;
  onChecked(selected: boolean, shiftKey: boolean): void;
  onSave(property: Property, value: PropertyApiValues): Promise<void>;
}) {
  const canEdit = () => canEditProject(props.row.project);
  const hasColumn = (column: TaskGridColumnId) =>
    props.columns.includes(column);
  const properties = () => [...props.row.properties];
  const propertyFor = (id: string) =>
    props.row.properties.find(
      (property) => property.propertyDefinitionId === id
    );
  const updated = () => {
    const date = new Date(props.row.project.updatedAt);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const progressLabel = () => {
    const total = props.row.project.taskCount ?? 0;
    const completed = props.row.project.completedTaskCount ?? 0;
    if (total === 0) return t('common.progressNoTasks');
    if (completed >= total) return t('common.progressAllDone');
    return t('common.progressTasksDone', { completed, count: total });
  };
  return (
    <PropertiesProvider
      entityId={props.row.project.id}
      entityType="INITIATIVE"
      canEdit={canEdit()}
      properties={properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{
        saveProperty: props.onSave,
        saveDate: (property, date) =>
          props.onSave(property, { valueType: 'DATE', value: date }),
      }}
    >
      <div
        id={props.rowId}
        role="row"
        aria-selected={props.checked}
        tabIndex={-1}
        onClick={props.onOpen}
        onMouseMove={props.onFocus}
        data-press-surface
        class={cn(
          'soup-list-entity @container/entity mx-1 relative flex min-h-10 w-[calc(100%-0.5rem)] flex-col rounded-xl py-0.5',
          {
            'bg-list-selected': props.checked,
            'bg-list-selected-highlighted': props.checked && props.highlighted,
            'bg-list-highlighted': props.highlighted && !props.checked,
            'hover:bg-list-hover': !props.highlighted && !props.checked,
          }
        )}
      >
        <Entity.Layout
          class="task-grid-row project-grid-row grid min-h-[inherit] w-full grid-rows-[1fr] items-center gap-2 px-2 text-sm"
          style={taskGridTemplate(props.columns)}
        >
          <Show when={hasColumn('indicator')}>
            <Entity.Slot placement="indicator" class="size-full">
              <MultiSelectCheckbox
                checked={props.checked}
                onChecked={props.onChecked}
              />
            </Entity.Slot>
          </Show>
          <Entity.Slot
            placement="content"
            class="flex min-w-0 items-center gap-2 truncate font-medium"
          >
            <EntityIcon
              targetType="initiative"
              appearance={props.row.project.appearance}
              size="xs"
              theme="monochrome"
              class="text-ink-muted"
            />
            <span class="min-w-0 truncate">{props.row.project.name}</span>
          </Entity.Slot>
          <For each={TASK_GRID_COLUMNS}>
            {(column) => (
              <Entity.Slot
                placement={column.id}
                class="flex min-w-0 items-center text-xs @max-[840px]/u-list:justify-center"
              >
                <Show when={propertyFor(column.defId)}>
                  {(property) => (
                    <ListPropertyValue
                      entityId={props.row.project.id}
                      property={property()}
                    />
                  )}
                </Show>
              </Entity.Slot>
            )}
          </For>
          <Show when={hasColumn('createdBy')}>
            <Entity.Slot
              placement="createdBy"
              class="min-w-0 text-xs text-ink-muted @max-[1220px]/u-list:hidden"
            >
              <Switch fallback={<span>—</span>}>
                <Match
                  when={
                    props.row.project.taskCount !== undefined &&
                    props.row.project.completedTaskCount !== undefined
                  }
                >
                  <ProgressPill
                    label={progressLabel()}
                    value={props.row.project.completedTaskCount ?? 0}
                    max={props.row.project.taskCount ?? 0}
                  />
                </Match>
              </Switch>
            </Entity.Slot>
          </Show>
          <Show when={hasColumn('timestamp')}>
            <Entity.Slot
              placement="timestamp"
              class="text-right text-xs font-light text-ink-extra-muted @max-[840px]/u-list:hidden"
            >
              <time dateTime={props.row.project.updatedAt}>{updated()}</time>
            </Entity.Slot>
          </Show>
        </Entity.Layout>
      </div>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
