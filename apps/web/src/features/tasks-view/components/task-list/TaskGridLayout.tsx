import { useRegisterPriorityCollapseItem } from '@app/components/priority-collapse/createPriorityCollapser';
import {
  createPriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from '@app/components/priority-collapse/PriorityCollapseOverflowSensor';
import {
  Entity,
  isProjectContainedEntity,
  MultiSelectCheckbox,
  OwnerLabel,
  ProjectBreadCrumb,
  type TaskEntityWithProperties,
  UnreadIndicator,
} from '@entity';
import { SharedBadgeSmall } from '@entity/components/Badges';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import { soupPropertyToProperty } from '@entity/extractors-property';
import { EntityReferenceProperties } from '@entity/extractors-property/entity-reference-properties';
import { TaskPropertyControl } from '@entity/extractors-property/task-property-control';
import { getTaskDueDate, isTaskClosed } from '@entity/utils/task-properties';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { EntityRowTags } from '@property/tags';
import type { Property, PropertyApiValues } from '@property/types';
import { hasValue } from '@property/utils';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createMemo,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  type DateBucketBoundaries,
  taskDueDateUrgency,
} from '../../core/task-due-date';
import {
  showTaskProperty,
  type TaskPropertyDisplay,
} from '../../core/task-property-display';
import {
  TASK_GRID_COLUMNS,
  TASK_PROJECT_COLUMN,
  type TaskGridColumn,
  taskGridTemplate,
  taskListColumns,
} from './task-grid-template';

const EPOCH = new Date(0).toISOString();

/**
 * Build a placeholder Property for a column when the entity doesn't yet have
 * the property attached. Lets the editor open and create the property on save.
 */
function buildStubProperty(col: TaskGridColumn): Property {
  const stubSoup: SoupProperty = {
    id: `pending:${col.defId}`,
    definition: {
      id: col.defId,
      display_name: col.label,
      data_type: col.dataType,
      is_metadata: false,
      is_multi_select: col.isMultiSelect,
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: col.specificEntityType,
      created_at: EPOCH,
      updated_at: EPOCH,
    },
  };
  return soupPropertyToProperty(stubSoup);
}

type TaskGridLayoutProps = Omit<LayoutProps, 'entity'> & {
  entity: TaskEntityWithProperties;
  onFilterByTag?: (optionId: string) => void;
  compact?: boolean;
  calendar: Accessor<DateBucketBoundaries>;
  propertyDisplay: TaskPropertyDisplay;
  referencePropertyIds?: readonly string[];
};

export function TaskGridLayout(props: TaskGridLayoutProps) {
  const entity = () => props.entity;

  const propertyMap = createMemo(() => {
    const map = new Map<string, Property>();
    for (const sp of entity().properties ?? []) {
      try {
        const property = soupPropertyToProperty(sp);
        map.set(property.propertyDefinitionId, property);
      } catch (error) {
        console.warn('Skipping property with unsupported type', error);
      }
    }
    return map;
  });

  const properties = createMemo(() => Array.from(propertyMap().values()));
  const collapseController = createPriorityCollapseController();
  const columns = () =>
    taskListColumns(props.propertyDisplay, props.showProject === true).filter(
      (column) => column !== 'indicator' || !props.hideCheckbox
    );
  const propertyColumns = () =>
    columns().flatMap((id) =>
      [TASK_PROJECT_COLUMN, ...TASK_GRID_COLUMNS].filter(
        (column) => column.id === id
      )
    );
  const mode = (column: TaskGridColumn) => {
    if (column.id === 'initiative') return props.propertyDisplay.project;
    if (column.id === 'dueDate') return props.propertyDisplay.dueDate;
    if (column.id === 'priority') return props.propertyDisplay.priority;
    if (column.id === 'status') return 'show';
    return props.propertyDisplay.assignees;
  };
  const propertyVisible = (column: TaskGridColumn) => {
    const property = propertyMap().get(column.defId);
    return showTaskProperty(
      mode(column),
      Boolean(property && hasValue(property))
    );
  };
  const showPriority = () => {
    const priority = propertyMap().get(SYSTEM_PROPERTY_IDS.PRIORITY);
    return showTaskProperty(
      props.propertyDisplay.priority,
      Boolean(priority && hasValue(priority))
    );
  };

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entity.id,
          entityType: EntityType.TASK,
          property,
          apiValues,
        },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  const dueDateClass = () => {
    const urgency = taskDueDateUrgency(
      getTaskDueDate(props.entity),
      isTaskClosed(props.entity),
      props.calendar()
    );
    return cn({
      'text-failure': urgency === 'danger',
      'text-warning': urgency === 'warning',
      'text-ink-muted': !urgency,
    });
  };

  return (
    <PropertiesProvider
      entityId={props.entity.id}
      entityType={EntityType.TASK}
      canEdit={true}
      properties={properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={saveHandler}
    >
      <Switch>
        <Match when={props.compact}>
          <Entity.Layout
            class="soup-row-narrow grid w-full items-center gap-x-0 pr-2 pl-0 text-sm"
            style={{
              'grid-template-columns': '0.5rem minmax(0, 1fr) max-content',
              'grid-template-rows': '44px',
              'grid-template-areas': '"indicator title properties"',
            }}
          >
            <Entity.Slot placement="indicator" class="relative">
              <UnreadIndicator active={props.unread} />
            </Entity.Slot>
            <Entity.Slot
              placement="title"
              class="ph-no-capture flex min-w-0 items-center gap-1 overflow-hidden font-semibold"
            >
              <Show when={showPriority()}>
                <TaskPropertyControl
                  entity={props.entity}
                  property="priority"
                />
              </Show>
              <div class="-mr-1 -ml-1 flex shrink-0 items-center">
                <TaskPropertyControl entity={props.entity} property="status" />
              </div>
              <Entity.Title entity={props.entity} />
              <Show when={props.propertyDisplay.tags !== 'hide'}>
                <EntityRowTags
                  entityId={props.entity.id}
                  entityType={EntityType.TASK}
                  properties={entity().properties}
                  maxVisible={0}
                  onFilterByTag={props.onFilterByTag}
                  class="ml-auto shrink-0"
                />
              </Show>
            </Entity.Slot>
            <Entity.Slot
              placement="properties"
              class="flex items-center justify-end gap-1"
            >
              <For each={propertyColumns()}>
                {(column) => (
                  <Show when={propertyVisible(column)}>
                    <div
                      class={cn(
                        'min-w-0 @container/slot',
                        column.id === 'assignees' ? 'w-11' : 'w-8'
                      )}
                    >
                      <ListPropertyValue
                        entityId={props.entity.id}
                        property={
                          propertyMap().get(column.defId) ??
                          buildStubProperty(column)
                        }
                        class={
                          column.id === 'dueDate' ? dueDateClass() : undefined
                        }
                      />
                    </div>
                  </Show>
                )}
              </For>
            </Entity.Slot>
          </Entity.Layout>
        </Match>
        <Match when={true}>
          <Entity.Layout
            class={cn(
              'task-grid-row task-grid-icon-creator w-full min-h-[inherit] items-center text-sm px-2',
              'gap-2 grid grid-rows-[1fr]'
            )}
            style={taskGridTemplate(columns())}
          >
            <Show when={!props.hideCheckbox}>
              <Entity.Slot
                placement="indicator"
                class="relative size-full group"
              >
                <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
                  <UnreadIndicator active={props.unread} />
                </div>
                <div
                  class={cn(
                    'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
                    {
                      'opacity-100': props.checked,
                    }
                  )}
                >
                  <MultiSelectCheckbox
                    checked={props.checked}
                    onChecked={props.onChecked}
                  />
                </div>
              </Entity.Slot>
            </Show>

            <Entity.Slot
              placement="content"
              ref={collapseController.setRow}
              class={cn(
                'ph-no-capture min-w-0 font-medium',
                !props.hideCheckbox && 'ms-2'
              )}
            >
              <PriorityCollapseOverflowSensor
                controller={collapseController}
                truncateAsLastResort
                class="w-full min-w-0 overflow-hidden"
                contentClass="flex min-w-full items-center gap-2"
              >
                <Show when={showPriority()}>
                  <TaskPropertyControl
                    entity={props.entity}
                    property="priority"
                  />
                </Show>
                <div class="-mr-1 flex shrink-0 items-center touch:-mr-2">
                  <TaskPropertyControl
                    entity={props.entity}
                    property="status"
                  />
                </div>
                <span class="flex min-w-0 flex-1 items-center gap-1">
                  <span class="min-w-0 truncate">
                    <Entity.Title entity={props.entity} />
                  </span>
                  <Show when={props.isShared}>
                    <span
                      class={cn(
                        'task-shared-badge shrink-0',
                        props.propertyDisplay.createdBy !== 'hide' && 'hidden'
                      )}
                    >
                      <SharedBadgeSmall ownerId={props.entity.ownerId} />
                    </span>
                  </Show>
                </span>
                <Show
                  when={isProjectContainedEntity(props.entity) && props.entity}
                >
                  {(entity) => {
                    const collapsed = useRegisterPriorityCollapseItem(
                      collapseController.collapser,
                      { id: 'folder', priority: Number.MIN_SAFE_INTEGER }
                    );
                    return (
                      <span class="ph-no-capture text-ink text-xs shrink-0">
                        <ProjectBreadCrumb
                          entity={entity()}
                          onClick={props.onProjectClick}
                          collapsed={collapsed()}
                        />
                      </span>
                    );
                  }}
                </Show>

                <Show when={props.referencePropertyIds}>
                  {(ids) => (
                    <EntityReferenceProperties
                      entity={props.entity}
                      propertyIds={ids()}
                      compact={false}
                    />
                  )}
                </Show>
                <Show when={props.propertyDisplay.tags !== 'hide'}>
                  <EntityRowTags
                    entityId={props.entity.id}
                    entityType={EntityType.TASK}
                    properties={entity().properties}
                    collapse={collapseController.collapser}
                    onFilterByTag={props.onFilterByTag}
                    class="ml-auto"
                  />
                </Show>
              </PriorityCollapseOverflowSensor>
            </Entity.Slot>

            <For each={propertyColumns()}>
              {(col) => (
                <Entity.Slot
                  placement={col.id}
                  class="ms-2 flex items-center min-w-0 text-xs ph-no-capture @container/slot @max-[840px]/u-list:justify-center"
                >
                  <Show when={propertyVisible(col)}>
                    <ListPropertyValue
                      entityId={props.entity.id}
                      class={col.id === 'dueDate' ? dueDateClass() : undefined}
                      property={
                        propertyMap().get(col.defId) ?? buildStubProperty(col)
                      }
                    />
                  </Show>
                </Entity.Slot>
              )}
            </For>

            <Show when={props.propertyDisplay.updated !== 'hide'}>
              <Entity.Slot
                placement="timestamp"
                class="task-updated-cell ms-2 whitespace-nowrap text-xs text-right text-ink-extra-muted font-light"
              >
                <Show when={!props.hasNotifications}>
                  <Entity.Timestamp entity={props.entity} />
                </Show>
              </Entity.Slot>
            </Show>

            <Show when={props.propertyDisplay.createdBy !== 'hide'}>
              <Entity.Slot
                placement="createdBy"
                class="task-creator-cell ms-2 flex items-center justify-end min-w-0 text-xs text-ink-muted ph-no-capture"
              >
                <OwnerLabel
                  ownerId={props.entity.ownerId}
                  viewerLabel="Me"
                  iconOnly
                  iconClass="@max-[840px]/u-list:size-5"
                />
              </Entity.Slot>
            </Show>
          </Entity.Layout>
        </Match>
      </Switch>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
