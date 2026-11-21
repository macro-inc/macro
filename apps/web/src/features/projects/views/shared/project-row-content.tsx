import {
  TASK_GRID_COLUMNS,
  type TaskGridColumnId,
  taskGridTemplate,
} from '@app/features/tasks-view/components/task-list/task-grid-template';
import { EntityIcon } from '@core/component/EntityIcon';
import { Entity, MultiSelectCheckbox } from '@entity';
import { buildStartDateDefaultProperty } from '@entity/extractors-property';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import { startDueEditorFor } from '@property/editors/popover/start-due-editor-for';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { isDateProperty } from '@property/utils';
import { formatStartDue, startDueOf } from '@property/utils/start-due';
import { cn } from '@ui/utils/classname';
import { For, Show } from 'solid-js';
import { ProjectProgress } from '../../components/project-progress';
import type { ProjectRow as ProjectRowData } from '../../context/projects-context';
import { useProjectsContext } from '../../context/projects-context';
import { canEditProject } from '../../core/project';
import type { ProjectRowProps } from '../../project-row';

export const PROJECT_GRID_COLUMNS = [
  'indicator',
  'content',
  'status',
  'priority',
  'assignees',
  'dueDate',
  'timestamp',
] as const satisfies readonly TaskGridColumnId[];
export const PROJECT_TOUCH_GRID_COLUMNS = [
  'content',
  'status',
  'priority',
  'assignees',
  'dueDate',
] as const satisfies readonly TaskGridColumnId[];
export const GRID_STYLE = taskGridTemplate(PROJECT_GRID_COLUMNS);

export function ProjectRowName(props: { row: ProjectRowData }) {
  return (
    <span class="flex min-w-0 items-center gap-1 mobile:gap-1.5">
      <EntityIcon
        targetType="initiative"
        appearance={props.row.project.appearance}
        size="xs"
        theme="monochrome"
        class="shrink-0 text-ink-muted"
      />
      <span class="flex min-w-0 items-center gap-1">
        <span class="min-w-0 truncate">{props.row.project.name}</span>
        <ProjectProgress project={props.row.project} />
      </span>
    </span>
  );
}

const PROJECT_PROPERTY_COLUMNS = PROJECT_GRID_COLUMNS.flatMap((id) =>
  TASK_GRID_COLUMNS.filter((column) => column.id === id)
);

export function ProjectRowColumns(
  props: ProjectRowProps & {
    columns?: readonly TaskGridColumnId[];
  }
) {
  const columns = () => props.columns ?? PROJECT_GRID_COLUMNS;
  const canEdit = () => canEditProject(props.row.project);
  const propertyFor = (id: string) =>
    props.row.properties.find(
      (property) => property.propertyDefinitionId === id
    ) ??
    props.definitions?.find((property) => property.propertyDefinitionId === id);
  // The due date cell reads as the range and sets the start too.
  const context = usePropertiesContext();
  const projects = useProjectsContext();
  const startDateEnabled = () => projects.startDatesEnabled?.() ?? false;
  const startDate = () => {
    const property =
      propertyFor(SYSTEM_PROPERTY_IDS.START_DATE) ??
      buildStartDateDefaultProperty();
    return isDateProperty(property) ? property : undefined;
  };
  const dueDatesText = (property: Property) => {
    if (
      !startDateEnabled() ||
      property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE
    ) {
      return undefined;
    }
    return formatStartDue(startDueOf(startDate(), property));
  };
  const dueDatesEditor = startDueEditorFor({
    field: 'due',
    enabled: startDateEnabled,
    other: startDate,
    saveOther: (property, value) =>
      context.saveHandler.saveProperty(property, { valueType: 'DATE', value }),
  });
  const updated = () => {
    const date = new Date(props.row.project.updatedAt);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Entity.Layout
      class={cn(
        'task-grid-row task-grid-icon-creator project-grid-row grid min-h-[inherit] w-full grid-rows-[1fr] items-center gap-2 px-2 text-sm',
        startDateEnabled() && 'task-grid-dates'
      )}
      style={taskGridTemplate(columns())}
    >
      <Show when={columns().includes('indicator')}>
        <Entity.Slot placement="indicator" class="size-full">
          <MultiSelectCheckbox
            checked={props.checked}
            onChecked={props.onChecked}
          />
        </Entity.Slot>
      </Show>
      <Entity.Slot placement="content" class="ms-2 min-w-0 font-medium">
        <ProjectRowName row={props.row} />
      </Entity.Slot>
      <For
        each={PROJECT_PROPERTY_COLUMNS.filter((column) =>
          columns().includes(column.id)
        )}
      >
        {(column) => (
          <Entity.Slot
            placement={column.id}
            on:click={{
              capture: true,
              handleEvent: (event) => {
                // Read-only property triggers must not swallow project navigation.
                if (canEdit()) return;
                event.preventDefault();
                event.stopPropagation();
                props.onOpen(event);
              },
            }}
            class="ms-2 flex min-w-0 items-center text-xs @container/slot @max-[840px]/u-list:justify-center"
          >
            <Show when={propertyFor(column.defId)}>
              {(property) => (
                <ListPropertyValue
                  entityId={props.row.project.id}
                  property={property()}
                  valueText={dueDatesText(property())}
                  editor={column.id === 'dueDate' ? dueDatesEditor : undefined}
                />
              )}
            </Show>
          </Entity.Slot>
        )}
      </For>
      <Show when={columns().includes('timestamp')}>
        <Entity.Slot
          placement="timestamp"
          class="task-updated-cell ms-2 whitespace-nowrap text-right text-xs font-light text-ink-extra-muted @max-[840px]/u-list:text-center"
        >
          <time dateTime={props.row.project.updatedAt}>{updated()}</time>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}
