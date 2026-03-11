import type { TaskWithProperties } from '@block-channel/hooks/taskmode';
import { EntityIcon } from '@core/component/EntityIcon';
import { propertyApiValuesToNormalized } from '@core/component/Properties/api/converters';
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
  PropertyOption,
} from '@core/component/Properties/types';
import { filterMap } from '@core/util/list';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { queryReadyGate } from '@queries/gate';
import { createMemo, For, Show } from 'solid-js';

const PREVIEW_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

type TaskPreviewRowProps = {
  task: TaskWithProperties;
  onUpdatePropertyValue: (
    propertyDefinitionId: string,
    value: PropertyApiValues
  ) => void;
};

function extractPropertyValue(
  definition: PropertyDefinition,
  savedValues: Record<string, PropertyApiValues>,
  options: Map<string, PropertyOption[]>
) {
  const { type, value } = propertyApiValuesToNormalized(
    savedValues[definition.id]
  );
  if (type === 'EMPTY') return null;
  if (
    definition.data_type === 'SELECT_NUMBER' ||
    definition.data_type === 'SELECT_STRING'
  ) {
    const opts = options.get(definition.id);
    if (!opts) return null;
    if (Array.isArray(value)) {
      return filterMap(value as string[], (id) => {
        const opt = opts.find((opt) => opt.id === id);
        return opt ? opt.id : undefined;
      });
    }
  } else {
    return value;
  }
}

function TaskPropertyRow(props: {
  task: TaskWithProperties;
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

export function TaskPreviewRow(props: TaskPreviewRowProps) {
  const systemPropertiesQuery = useListPropertiesQuery(
    () => ({
      scope: 'system',
      includeOptions: true,
      forEntityType: 'TASK',
    }),
    () => true
  );

  const definitions = createMemo(() => {
    if (!queryReadyGate(systemPropertiesQuery))
      return new Map<string, PropertyDefinition>();
    return new Map(
      systemPropertiesQuery.data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  });

  const options = createMemo(() => {
    if (!queryReadyGate(systemPropertiesQuery))
      return new Map<string, PropertyOption[]>();
    return new Map(
      systemPropertiesQuery.data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const opts = 'property_options' in p ? p.property_options : [];
        return [definition.id, opts];
      })
    );
  });

  const mergedPropertyValues = createMemo(
    (): Record<string, PropertyApiValues> => {
      const values: Record<string, PropertyApiValues> = {};

      if (props.task.assigneeUserIds.length > 0) {
        values[SYSTEM_PROPERTY_IDS.ASSIGNEES] = {
          valueType: 'ENTITY',
          refs: props.task.assigneeUserIds.map((id) => ({
            entity_id: id,
            entity_type: 'USER' as const,
          })),
        };
      }

      if (props.task.dueDate) {
        values[SYSTEM_PROPERTY_IDS.DUE_DATE] = {
          valueType: 'DATE',
          value: props.task.dueDate,
        };
      }

      return { ...values, ...props.task.propertyValues };
    }
  );

  // Cast needed: Property is a discriminated union, but we build it dynamically
  // from definition.data_type which TypeScript can't narrow statically
  const properties = createMemo((): Property[] => {
    return filterMap(PREVIEW_PROPERTIES, (id) => {
      const definition = definitions().get(id);
      if (!definition) return;
      return {
        propertyId: `preview-${props.task.lineIndex}-${definition.id}`,
        propertyDefinitionId: definition.id,
        displayName: definition.display_name,
        isMultiSelect: definition.is_multi_select,
        owner: definition.owner,
        specificEntityType: definition.specific_entity_type ?? null,
        updatedAt: new Date(0),
        createdAt: new Date(0),
        valueType: definition.data_type,
        value: extractPropertyValue(
          definition,
          mergedPropertyValues(),
          options()
        ),
        options: options().get(definition.id),
      } as Property;
    });
  });

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      props.onUpdatePropertyValue(property.propertyDefinitionId, value);
    },
    saveDate: async (property: Property, date: Date) => {
      props.onUpdatePropertyValue(property.propertyDefinitionId, {
        valueType: 'DATE',
        value: date,
      });
    },
  };

  return (
    <Show
      when={queryReadyGate(systemPropertiesQuery)}
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
