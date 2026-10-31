import {
  TASK_GRID_COLUMNS,
  type TaskGridColumnId,
  taskGridTemplate,
} from '@app/features/tasks-view/components/task-list/task-grid-template';
import '@app/features/tasks-view/components/task-list/task-list.css';
import { Entity, MultiSelectCheckbox } from '@entity';
import ProjectIcon from '@icon/system/regular/cube.svg';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import { cn, ProgressPill } from '@ui';
import { For, Match, Show, Suspense, Switch } from 'solid-js';
import type { ProjectRow as ProjectRowData } from '../context/projects-context';
import { canEditProject } from '../core/project';

// Projects reuse the task grid; its project column holds the due date.
export const PROJECT_GRID_COLUMNS = [
  'indicator',
  'content',
  'status',
  'priority',
  'assignees',
  'initiative',
  'createdBy',
  'timestamp',
] as const satisfies readonly TaskGridColumnId[];

const gridStyle = taskGridTemplate(PROJECT_GRID_COLUMNS);
const columns = [
  { area: 'content', label: 'Project' },
  ...TASK_GRID_COLUMNS.map((column) => ({
    area: column.id,
    label: column.label,
  })),
  { area: 'initiative', label: 'Due date' },
  { area: 'createdBy', label: 'Tasks' },
  { area: 'timestamp', label: 'Updated' },
];

export function ProjectListHeader() {
  return (
    <div
      role="row"
      class="task-grid-row grid h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={gridStyle}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <For each={columns}>
        {(column) => (
          <span
            role="columnheader"
            style={{ 'grid-area': column.area }}
            class={cn(
              'truncate',
              column.area === 'createdBy' && '@max-[1220px]/u-list:hidden',
              column.area === 'timestamp' && 'text-right'
            )}
          >
            {column.label}
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
  highlighted: boolean;
  checked: boolean;
  onFocus(): void;
  onOpen(event: MouseEvent): void;
  onChecked(selected: boolean, shiftKey: boolean): void;
  onSave(property: Property, value: PropertyApiValues): Promise<void>;
}) {
  const canEdit = () => canEditProject(props.row.project);
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
          class="task-grid-row grid min-h-[inherit] w-full grid-rows-[1fr] items-center gap-2 px-2 text-sm"
          style={gridStyle}
        >
          <Entity.Slot placement="indicator" class="size-full">
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </Entity.Slot>
          <Entity.Slot
            placement="content"
            class="flex min-w-0 items-center gap-2 truncate font-medium"
          >
            <ProjectIcon class="size-4 shrink-0 text-ink-muted" />
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
          <Entity.Slot placement="initiative" class="min-w-0 text-xs">
            <Show when={propertyFor(SYSTEM_PROPERTY_IDS.DUE_DATE)}>
              {(property) => (
                <ListPropertyValue
                  entityId={props.row.project.id}
                  property={property()}
                />
              )}
            </Show>
          </Entity.Slot>
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
                  label="Task progress"
                  value={props.row.project.completedTaskCount ?? 0}
                  max={props.row.project.taskCount ?? 0}
                />
              </Match>
            </Switch>
          </Entity.Slot>
          <Entity.Slot
            placement="timestamp"
            class="text-right text-xs font-light text-ink-extra-muted"
          >
            <time dateTime={props.row.project.updatedAt}>{updated()}</time>
          </Entity.Slot>
        </Entity.Layout>
      </div>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
