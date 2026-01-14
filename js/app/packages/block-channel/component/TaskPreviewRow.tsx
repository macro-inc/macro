import { EntityIcon } from '@core/component/EntityIcon';
import { Modals } from '@core/component/Properties/component/modal';
import { PropertyValue } from '@core/component/Properties/component/propertyValue/PropertyValue';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  usePropertiesContext,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import type { PotentialTask } from '@core/util/taskExtraction';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { createMemo, For, Show } from 'solid-js';

type TaskPreviewRowProps = {
  task: PotentialTask;
  onUpdateProperty: (
    property: 'statusOptionId' | 'priorityOptionId' | 'dueDate',
    value: string | null
  ) => void;
  onUpdateAssignees: (assigneeUserIds: string[]) => void;
};

// System owner for system properties
const SYSTEM_OWNER = { scope: 'system' as const };

/**
 * Inner component that renders task row with property pills.
 * Uses context to wire up date picker for DATE properties.
 */
function TaskPropertyRow(props: {
  task: PotentialTask;
  properties: Property[];
}) {
  const { openDatePicker, openPropertyEditor } = usePropertiesContext();

  const handleEdit = (property: Property, anchor?: HTMLElement) => {
    if (property.valueType === 'DATE') {
      openDatePicker(property as Property & { valueType: 'DATE' }, anchor);
    } else {
      openPropertyEditor(property, anchor);
    }
  };

  return (
    <div class="flex items-center gap-2 text-sm py-1">
      <EntityIcon targetType="task" size="sm" class="flex-shrink-0" />
      <span class="truncate flex-1 text-ink min-w-0">
        {props.task.title || '(empty)'}
      </span>
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <For each={props.properties}>
          {(property) => (
            <PropertyValue
              property={property}
              condensed={property.valueType !== 'DATE'}
              onEdit={handleEdit}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/**
 * Individual task row in the preview panel.
 * Shows task title with editable status/priority/due date pills and assignee avatars.
 */
export function TaskPreviewRow(props: TaskPreviewRowProps) {
  // Fetch system properties with options
  const systemPropertiesQuery = useListPropertiesQuery(
    () => ({
      scope: 'system',
      includeOptions: true,
      forEntityType: 'TASK',
    }),
    () => true
  );

  // Extract definitions and options from query
  const definitionsMap = createMemo(() => {
    if (!systemPropertiesQuery.isSuccess || !systemPropertiesQuery.data)
      return new Map();
    return new Map(
      systemPropertiesQuery.data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  });

  const optionsMap = createMemo(() => {
    if (!systemPropertiesQuery.isSuccess || !systemPropertiesQuery.data)
      return new Map();
    return new Map(
      systemPropertiesQuery.data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  });

  // Build properties from task data and fetched definitions
  const properties = createMemo((): Property[] => {
    const now = new Date().toISOString();
    const defs = definitionsMap();
    const opts = optionsMap();
    const result: Property[] = [];

    // Status property
    const statusDef = defs.get(SYSTEM_PROPERTY_IDS.STATUS);
    if (statusDef) {
      result.push({
        propertyId: `preview-status-${props.task.lineIndex}`,
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
        displayName: statusDef.display_name,
        isMultiSelect: statusDef.is_multi_select,
        owner: SYSTEM_OWNER,
        specificEntityType: statusDef.specific_entity_type ?? null,
        createdAt: now,
        updatedAt: now,
        valueType: 'SELECT_STRING',
        value: props.task.statusOptionId ? [props.task.statusOptionId] : null,
        options: opts.get(SYSTEM_PROPERTY_IDS.STATUS) ?? [],
      });
    }

    // Priority property
    const priorityDef = defs.get(SYSTEM_PROPERTY_IDS.PRIORITY);
    if (priorityDef) {
      result.push({
        propertyId: `preview-priority-${props.task.lineIndex}`,
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
        displayName: priorityDef.display_name,
        isMultiSelect: priorityDef.is_multi_select,
        owner: SYSTEM_OWNER,
        specificEntityType: priorityDef.specific_entity_type ?? null,
        createdAt: now,
        updatedAt: now,
        valueType: 'SELECT_STRING',
        value: props.task.priorityOptionId
          ? [props.task.priorityOptionId]
          : null,
        options: opts.get(SYSTEM_PROPERTY_IDS.PRIORITY) ?? [],
      });
    }

    // Due date property
    const dueDateDef = defs.get(SYSTEM_PROPERTY_IDS.DUE_DATE);
    if (dueDateDef) {
      result.push({
        propertyId: `preview-duedate-${props.task.lineIndex}`,
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
        displayName: dueDateDef.display_name,
        isMultiSelect: dueDateDef.is_multi_select,
        owner: SYSTEM_OWNER,
        specificEntityType: dueDateDef.specific_entity_type ?? null,
        createdAt: now,
        updatedAt: now,
        valueType: 'DATE',
        value: props.task.dueDate ? new Date(props.task.dueDate) : null,
      });
    }

    // Assignees property
    const assigneesDef = defs.get(SYSTEM_PROPERTY_IDS.ASSIGNEES);
    if (assigneesDef) {
      result.push({
        propertyId: `preview-assignees-${props.task.lineIndex}`,
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        displayName: assigneesDef.display_name,
        isMultiSelect: assigneesDef.is_multi_select,
        owner: SYSTEM_OWNER,
        specificEntityType: assigneesDef.specific_entity_type ?? null,
        createdAt: now,
        updatedAt: now,
        valueType: 'ENTITY',
        value:
          props.task.assigneeUserIds.length > 0
            ? props.task.assigneeUserIds.map((id) => ({
                entity_id: id,
                entity_type: 'USER' as const,
              }))
            : null,
      });
    }

    return result;
  });

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      if (property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS) {
        const optionId =
          value.valueType === 'SELECT_STRING' && value.values?.[0]
            ? value.values[0]
            : null;
        props.onUpdateProperty('statusOptionId', optionId);
      } else if (
        property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY
      ) {
        const optionId =
          value.valueType === 'SELECT_STRING' && value.values?.[0]
            ? value.values[0]
            : null;
        props.onUpdateProperty('priorityOptionId', optionId);
      } else if (
        property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
      ) {
        const userIds =
          value.valueType === 'ENTITY' && value.refs
            ? value.refs.map((r) => r.entity_id)
            : [];
        props.onUpdateAssignees(userIds);
      }
    },
    saveDate: async (property: Property, date: Date) => {
      if (property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.DUE_DATE) {
        props.onUpdateProperty('dueDate', date.toISOString());
      }
    },
  };

  return (
    <Show
      when={systemPropertiesQuery.isSuccess}
      fallback={
        <div class="flex items-center gap-2 text-sm py-1 text-ink-muted">
          <EntityIcon targetType="task" size="sm" class="flex-shrink-0" />
          <span class="truncate flex-1">{props.task.title || '(empty)'}</span>
        </div>
      }
    >
      <PropertiesProvider
        entityType="TASK"
        canEdit={true}
        properties={properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <TaskPropertyRow task={props.task} properties={properties()} />
        <Modals />
      </PropertiesProvider>
    </Show>
  );
}
