import { toast } from '@core/component/Toast/Toast';
import { createTaskWithInitialSnapshot } from '@core/util/create';
import { filterMap } from '@core/util/list';
import {
  propertyApiValuesToNormalized,
  propertyValueToApi,
} from '@property/api/converters';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertySaveHandler } from '@property/context/PropertiesContext';
import { useLocalDocTags } from '@property/tags';
import type {
  Property,
  PropertyApiValues,
  PropertyOption,
} from '@property/types';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useTagsQuery } from '@queries/properties/tags';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import { createStore, reconcile, type Store, unwrap } from 'solid-js/store';

/** Props shown in the composer (Linear-style left-to-right order). */
const COMPOSER_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
];
const COMPOSER_PROPERTY_SET = new Set<string>(COMPOSER_PROPERTIES);

/** The default property values a fresh task composer starts from. */
export function defaultTaskPropertyValues(
  assigneeIds: string[]
): Record<string, PropertyApiValues> {
  return {
    [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
      valueType: 'ENTITY' as const,
      refs: [...new Set(assigneeIds)].map((entity_id) => ({
        entity_id,
        entity_type: 'USER' as const,
      })),
    },
    [SYSTEM_PROPERTY_IDS.STATUS]: {
      valueType: 'SELECT_STRING' as const,
      values: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
    },
  };
}

/**
 * Make a task and append props using the create_task endpoint.
 * @param taskTitle Title string
 * @param taskContent content markdown string
 * @param properties Stored prop value map
 * @param definitions The definitions map for extra meta data
 * @param upsertToHistory Callback that upserts the created task to history
 * @returns
 */
export async function createTaskWithProperties(
  taskTitle: string,
  taskContent: string,
  properties: Array<[string, PropertyApiValues]>,
  definitions: Map<
    string,
    PropertyDefinition | PropertyDefinitionDetailResponse
  >,
  upsertToHistory: (params: { itemId: string; itemType: 'document' }) => void
) {
  // Convert properties to API format (filter out null values)
  const propertyValues = properties.flatMap(([id, value]) => {
    const definition = definitions.get(id);
    const isMultiSelect = definition
      ? 'is_multi_select' in definition
        ? definition.is_multi_select
        : definition.isMultiSelect
      : value.valueType === 'SELECT_STRING' && !COMPOSER_PROPERTY_SET.has(id);
    const apiValue = propertyValueToApi(value, isMultiSelect);
    if (apiValue === null) return [];
    return [{ propertyId: id, value: apiValue }];
  });

  const createdTask = await createTaskWithInitialSnapshot({
    title: taskTitle,
    content: taskContent,
    propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
  });

  if (!createdTask) {
    toast.failure('Failed to create Task');
    return null;
  }

  // createTaskWithInitialSnapshot already revalidates Soup; just update history.
  upsertToHistory({
    itemId: createdTask.documentId,
    itemType: 'document',
  });

  return createdTask;
}

/**
 * Helper to get display value of local property
 * @param definition The prop definition
 * @param savedValues The map of saved vals by propDef id
 * @param options The map of the options for the prop from the server
 * @returns
 */
function extractPropertyValue(
  definition: PropertyDefinition,
  savedValues: Store<Record<string, PropertyApiValues>>,
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

/**
 * Local (not-yet-persisted) property state for a task composer: the system
 * property pills (status/priority/assignees/due date), tag state, and the
 * save handler that writes edits back into the local store. Shared between
 * the task compose dialog and the channel input's task mode.
 */
export function createTaskComposerProperties(args: {
  initialValues: Record<string, PropertyApiValues>;
}) {
  const [propertyValues, setPropertyValues] = createStore<
    Record<string, PropertyApiValues>
  >(args.initialValues);

  const systemPropertiesQuery = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  const tagsQuery = useTagsQuery();

  const definitions = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  };

  const createDefinitions = () => {
    const map = new Map<
      PropertyDefinition['id'],
      PropertyDefinition | PropertyDefinitionDetailResponse
    >(definitions());
    for (const tagSet of tagsQuery.data ?? []) {
      if (tagSet.definition) {
        map.set(tagSet.definition.id, tagSet.definition);
      }
    }
    return map;
  };

  const options = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  };

  const properties = (): Property[] => {
    return filterMap(COMPOSER_PROPERTIES, (id) => {
      const definition = definitions().get(id);
      if (!definition) return;
      return {
        propertyId: `compose-${definition.display_name}`,
        propertyDefinitionId: definition.id,
        displayName: definition.display_name,
        isMultiSelect: definition.is_multi_select,
        owner: definition.owner,
        specificEntityType: definition.specific_entity_type ?? null,
        updatedAt: new Date(0),
        createdAt: new Date(0),
        valueType: definition.data_type,
        value: extractPropertyValue(definition, propertyValues, options()),
        options: options().get(definition.id),
      } as Property;
    });
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      setPropertyValues(property.propertyDefinitionId, value);
    },
    saveDate: async (property: Property, date: Date) => {
      setPropertyValues(property.propertyDefinitionId, {
        valueType: 'DATE',
        value: date,
      });
    },
  };

  const composerTags = useLocalDocTags(
    (definitionId) => {
      const value = propertyValues[definitionId];
      return value?.valueType === 'SELECT_STRING' && value.values
        ? value.values
        : [];
    },
    (definition, optionIds) => {
      setPropertyValues(definition.id, {
        valueType: 'SELECT_STRING',
        values: optionIds,
      });
    }
  );

  /** Drops every applied tag value, keeping the composer's system props. */
  const clearComposerTags = () => {
    const next = structuredClone(unwrap(propertyValues));
    for (const [definitionId, value] of Object.entries(next)) {
      if (
        value.valueType === 'SELECT_STRING' &&
        !COMPOSER_PROPERTY_SET.has(definitionId)
      ) {
        delete next[definitionId];
      }
    }
    setPropertyValues(reconcile(next));
  };

  return {
    propertyValues,
    setPropertyValues,
    properties,
    saveHandler,
    composerTags,
    clearComposerTags,
    createDefinitions,
  };
}
