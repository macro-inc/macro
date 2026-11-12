import { ListColumnHeader } from '@app/components/list/ListColumnHeader';
import { NarrowRowGrid } from '@app/features/entity/composed/list-entity/narrow-row-grid';
import {
  TASK_GRID_COLUMNS,
  type TaskGridColumnId,
  taskGridTemplate,
} from '@app/features/tasks-view/components/task-list/task-grid-template';
import '@app/features/tasks-view/components/task-list/task-list.css';
import { t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { isMobile } from '@core/mobile/isMobile';
import { Entity, MultiSelectCheckbox } from '@entity';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import PriorityIcon from '@icon/system/regular/chart-bar.svg';
import StatusIcon from '@icon/system/regular/circle-dashed.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Property as PropertyControl } from '@property';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { Modals } from '@property/component/modal';
import { PropertyIconControl } from '@property/component/PropertyIconControl';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import { cn, ProgressRing, Tooltip } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import type { ProjectRow as ProjectRowData } from '../context/projects-context';
import { canEditProject } from '../core/project';

export const PROJECT_GRID_COLUMNS = [
  'indicator',
  'content',
  'status',
  'priority',
  'assignees',
  'dueDate',
  'timestamp',
] as const satisfies readonly TaskGridColumnId[];
const PROJECT_PROPERTY_COLUMNS = PROJECT_GRID_COLUMNS.flatMap((id) =>
  TASK_GRID_COLUMNS.filter((column) => column.id === id)
);
const GRID_STYLE = taskGridTemplate(PROJECT_GRID_COLUMNS);

export function ProjectListHeader(props: {
  onSortUpdated?: () => void;
  updatedSelected?: boolean;
  onTimestampWidthChange?: (width: number) => void;
}) {
  return (
    <div
      role="row"
      class="task-grid-row task-grid-icon-creator project-grid-row grid h-10 w-full shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={GRID_STYLE}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <span
        role="columnheader"
        class="ms-2 truncate"
        style={{ 'grid-area': 'content' }}
      >
        Project
      </span>
      <ListColumnHeader
        label="Status"
        area="status"
        narrowIcon={<StatusIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Priority"
        area="priority"
        narrowIcon={<PriorityIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Assignees"
        area="assignees"
        narrowIcon={<UsersIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Due date"
        area="dueDate"
        narrowIcon={<CalendarIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Updated"
        area="timestamp"
        class="task-updated-cell @max-[840px]/u-list:justify-center"
        align="end"
        narrowIcon={<ClockIcon class="size-4" />}
        onClick={props.onSortUpdated}
        active={props.updatedSelected}
        onWidthChange={props.onTimestampWidthChange}
      />
    </div>
  );
}

/** Projects share task controls and responsive tracks without pretending to be tasks. */
export function ProjectRow(props: {
  rowId: string;
  row: ProjectRowData;
  definitions?: readonly Property[];
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
    ) ??
    props.definitions?.find((property) => property.propertyDefinitionId === id);
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
  const hasProgress = () =>
    props.row.project.taskCount !== undefined &&
    props.row.project.completedTaskCount !== undefined;
  const progressFraction = () => {
    const total = props.row.project.taskCount ?? 0;
    return total > 0 ? (props.row.project.completedTaskCount ?? 0) / total : 0;
  };
  const name = () => (
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
        <Show when={hasProgress()}>
          <Tooltip.Root>
            <Tooltip.Trigger
              as="span"
              role="progressbar"
              aria-label={progressLabel()}
              aria-valuemin={0}
              aria-valuemax={props.row.project.taskCount ?? 0}
              aria-valuenow={props.row.project.completedTaskCount ?? 0}
              tabIndex={0}
              class="flex size-[22px] shrink-0 items-center justify-center [&_svg]:size-3.5"
            >
              <ProgressRing fraction={progressFraction()} />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content>{progressLabel()}</Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Show>
      </span>
    </span>
  );
  const propertyCells = () => (
    <For each={PROJECT_PROPERTY_COLUMNS}>
      {(column) => (
        <Entity.Slot
          placement={column.id}
          class="ms-2 flex min-w-0 items-center text-xs @container/slot @max-[840px]/u-list:justify-center"
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
  );

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
          'soup-list-entity @container/entity relative flex min-h-10 w-[calc(100%-0.5rem)] flex-col rounded-xl py-0.5 mx-1 mobile:mx-0 mobile:py-0',
          {
            'bg-list-selected': props.checked,
            'bg-list-selected-highlighted':
              props.checked && props.highlighted && !isMobile(),
            'bg-list-highlighted':
              props.highlighted && !props.checked && !isMobile(),
            'not-touch:hover:bg-list-hover':
              !props.highlighted && !props.checked,
          }
        )}
      >
        <Show
          when={!isMobile()}
          fallback={
            <NarrowRowGrid variant="compact">
              <Entity.Slot placement="indicator" />
              <Entity.Slot placement="title" class="min-w-0 font-medium">
                {name()}
              </Entity.Slot>
              <Entity.Slot
                placement="timestamp"
                class="flex items-center gap-1"
              >
                <Show when={propertyFor(SYSTEM_PROPERTY_IDS.STATUS)}>
                  {(property) => (
                    <PropertyIconControl
                      property={property()}
                      canEdit={canEdit()}
                      onSave={props.onSave}
                    />
                  )}
                </Show>
                <Show when={propertyFor(SYSTEM_PROPERTY_IDS.PRIORITY)}>
                  {(property) => (
                    <PropertyIconControl
                      property={property()}
                      canEdit={canEdit()}
                      onSave={props.onSave}
                    />
                  )}
                </Show>
                <Show when={propertyFor(SYSTEM_PROPERTY_IDS.ASSIGNEES)}>
                  {(property) => (
                    <PropertyControl.Root
                      property={property()}
                      canEdit={canEdit()}
                      onSave={props.onSave}
                    >
                      {(shown) => (
                        <>
                          <PropertyControl.Pill
                            aria-label="Change assignees"
                            data-blocks-navigation
                            stopPropagation={canEdit()}
                            class="flex size-9 items-center justify-center rounded-full border-0"
                          >
                            <PropertyControl.Icon
                              property={shown()}
                              class="size-5"
                            />
                          </PropertyControl.Pill>
                          <PropertyControl.PopoverEditor />
                        </>
                      )}
                    </PropertyControl.Root>
                  )}
                </Show>
              </Entity.Slot>
            </NarrowRowGrid>
          }
        >
          <Entity.Layout
            class="task-grid-row task-grid-icon-creator project-grid-row grid min-h-[inherit] w-full grid-rows-[1fr] items-center gap-2 px-2 text-sm"
            style={GRID_STYLE}
          >
            <Entity.Slot placement="indicator" class="size-full">
              <MultiSelectCheckbox
                checked={props.checked}
                onChecked={props.onChecked}
              />
            </Entity.Slot>
            <Entity.Slot placement="content" class="ms-2 min-w-0 font-medium">
              {name()}
            </Entity.Slot>
            {propertyCells()}
            <Entity.Slot
              placement="timestamp"
              class="task-updated-cell ms-2 whitespace-nowrap text-right text-xs font-light text-ink-extra-muted @max-[840px]/u-list:text-center"
            >
              <time dateTime={props.row.project.updatedAt}>{updated()}</time>
            </Entity.Slot>
          </Entity.Layout>
        </Show>
      </div>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
