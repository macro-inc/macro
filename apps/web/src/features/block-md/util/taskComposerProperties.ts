import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableProjects } from '@core/constant/featureFlags';
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
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { fetchEntityProperties } from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { createSignal } from 'solid-js';
import { createStore, reconcile, type Store, unwrap } from 'solid-js/store';

/**
 * Props shown in the composer (Linear-style left-to-right order). Project
 * shows only while Projects is enabled.
 */
export const DEFAULT_TASK_COMPOSER_PROPERTY_IDS = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PROJECT,
];
const COMPOSER_PROPERTY_SET = new Set<string>(
  DEFAULT_TASK_COMPOSER_PROPERTY_IDS
);

/** Exclude definitions that cannot be edited on a task or belong to Tags. */
export function taskComposerWritableDefinitions(
  definitions: PropertyDefinition[],
  tagSetIds: ReadonlySet<string> = new Set()
): PropertyDefinition[] {
  return definitions.filter(
    (definition) =>
      !definition.is_metadata &&
      definition.data_type !== 'TAG' &&
      definition.owner.scope !== 'database' &&
      !tagSetIds.has(definition.id)
  );
}

/** Keep the default order unless a host supplies its own visible property list. */
export function taskComposerVisiblePropertyIds(
  requested: readonly string[] | undefined,
  available: readonly PropertyDefinition[],
  projectsEnabled: boolean
): string[] {
  const ids = new Set(available.map((definition) => definition.id));
  return [...new Set(requested ?? DEFAULT_TASK_COMPOSER_PROPERTY_IDS)].filter(
    (id) =>
      ids.has(id) && (id !== SYSTEM_PROPERTY_IDS.PROJECT || projectsEnabled)
  );
}

/** Only Tags owns tag-set values; clearing tags must leave custom selects alone. */
export function withoutTaskComposerTags(
  values: Record<string, PropertyApiValues>,
  tagSetIds: ReadonlySet<string>
): Record<string, PropertyApiValues> {
  const next = structuredClone(values);
  for (const id of tagSetIds) delete next[id];
  return next;
}

/** The Project value naming `projectId`. */
export function taskComposerProjectValue(projectId: string): PropertyApiValues {
  return {
    valueType: 'ENTITY',
    refs: [{ entity_id: projectId, entity_type: 'INITIATIVE' }],
  };
}

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
  upsertToHistory: (params: { itemId: string; itemType: 'document' }) => void,
  options?: {
    revalidateSoup?: boolean;
    shareWithTeam?: boolean;
    /** Disable when the caller provides its own recovery notification. */
    showFailureToast?: boolean;
    onMutate?: () => void;
    /** The create response arrived, before history/project follow-up work. */
    onCreated?: (
      task: NonNullable<
        Awaited<ReturnType<typeof createTaskWithInitialSnapshot>>
      >
    ) => void;
  }
) {
  options?.onMutate?.();
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
    revalidateSoup: options?.revalidateSoup,
    shareWithTeam: options?.shareWithTeam,
    title: taskTitle,
    content: taskContent,
    propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
  });

  if (!createdTask) {
    if (options?.showFailureToast !== false)
      toast.failure('Failed to create Task');
    return null;
  }

  options?.onCreated?.(createdTask);

  // createTaskWithInitialSnapshot already revalidates Soup; just update history.
  upsertToHistory({
    itemId: createdTask.documentId,
    itemType: 'document',
  });

  // Creation keeps the task when a property is rejected, so confirm a chosen
  // project took and say when it didn't.
  const projectId = chosenProjectId(properties);
  if (
    projectId &&
    (await taskIsInProject(createdTask.documentId, projectId)) === false
  ) {
    toast.failure(
      'Task created, but could not be added to the project. Use Add to project from the task menu to try again.'
    );
  }

  return createdTask;
}

/** The project the composer's Project value names, if any. */
function chosenProjectId(
  properties: Array<[string, PropertyApiValues]>
): string | undefined {
  const project = properties.find(
    ([id]) => id === SYSTEM_PROPERTY_IDS.PROJECT
  )?.[1];
  if (project?.valueType !== 'ENTITY') return undefined;
  return project.refs?.find(
    (reference) => reference.entity_type === 'INITIATIVE'
  )?.entity_id;
}

/**
 * Whether the server has `taskId` in `projectId`, from its Project property;
 * undefined when the properties can't be read.
 */
async function taskIsInProject(
  taskId: string,
  projectId: string
): Promise<boolean | undefined> {
  const properties = await fetchEntityProperties('TASK', taskId).catch(
    () => undefined
  );
  if (!properties) return undefined;
  const project = properties.find(
    (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
  );
  if (project?.valueType !== 'ENTITY') return false;
  return (
    project.value?.some(
      (reference) =>
        reference.entity_type === 'INITIATIVE' &&
        reference.entity_id === projectId
    ) ?? false
  );
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
  initialVisiblePropertyIds?: string[];
  allDefinitions?: boolean;
}) {
  const [propertyValues, setPropertyValues] = createStore<
    Record<string, PropertyApiValues>
  >(args.initialValues);

  const [visiblePropertyIds, setVisiblePropertyIds] = createSignal(
    args.initialVisiblePropertyIds ?? DEFAULT_TASK_COMPOSER_PROPERTY_IDS
  );
  const systemPropertiesQuery = useListPropertiesQuery(() => ({
    scope: args.allDefinitions ? 'all' : 'system',
    includeOptions: true,
    forEntityType: args.allDefinitions ? 'TASK' : undefined,
  }));
  const tagsQuery = useTagsQuery();
  const [createdProperties, setCreatedProperties] = createSignal<
    PropertyDefinitionWithOptions[]
  >([]);
  const propertyDefinitions = () => {
    const fetched = systemPropertiesQuery.isSuccess
      ? systemPropertiesQuery.data
      : [];
    return [
      ...fetched,
      ...createdProperties().filter(
        (created) =>
          !fetched.some(
            (item) =>
              ('definition' in item ? item.definition.id : item.id) ===
              created.definition.id
          )
      ),
    ];
  };

  const availableDefinitions = () => {
    const tagSetIds = new Set(
      (tagsQuery.isSuccess ? tagsQuery.data : []).flatMap((tagSet) =>
        tagSet.definition ? [tagSet.definition.id] : []
      )
    );
    return taskComposerWritableDefinitions(
      propertyDefinitions().map((item) =>
        'definition' in item ? item.definition : item
      ),
      tagSetIds
    );
  };
  const definitions = () =>
    new Map(
      availableDefinitions().map((definition) => [definition.id, definition])
    );

  const createDefinitions = () => {
    const map = new Map<
      PropertyDefinition['id'],
      PropertyDefinition | PropertyDefinitionDetailResponse
    >(definitions());
    for (const tagSet of tagsQuery.isSuccess ? tagsQuery.data : []) {
      if (tagSet.definition) {
        map.set(tagSet.definition.id, tagSet.definition);
      }
    }
    return map;
  };

  const options = () => {
    const data = propertyDefinitions();
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  };

  const projects = useFeatureFlag(enableProjects);

  const visibleIds = () =>
    taskComposerVisiblePropertyIds(
      visiblePropertyIds(),
      availableDefinitions(),
      projects().enabled
    );
  const addableDefinitions = () =>
    availableDefinitions().filter(
      (definition) =>
        !visibleIds().includes(definition.id) &&
        (definition.id !== SYSTEM_PROPERTY_IDS.PROJECT || projects().enabled)
    );
  const addProperty = async (
    id: string,
    created?: PropertyDefinitionWithOptions
  ) => {
    if (created) {
      setCreatedProperties((current) => [
        ...current.filter((property) => property.definition.id !== id),
        created,
      ]);
    }
    if (!addableDefinitions().some((definition) => definition.id === id))
      return;
    setVisiblePropertyIds((current) => [...current, id]);
  };
  const availableProperties = () =>
    availableDefinitions()
      .filter(
        (definition) =>
          definition.id !== SYSTEM_PROPERTY_IDS.PROJECT || projects().enabled
      )
      .map((definition) =>
        toPropertyDefinitionDomain(definition, options().get(definition.id))
      );

  const properties = (): Property[] => {
    return filterMap(visibleIds(), (id) => {
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

  /** Drops applied tags without clearing other select properties. */
  const clearComposerTags = () => {
    const tagSetIds = new Set(
      (tagsQuery.isSuccess ? tagsQuery.data : []).flatMap((tagSet) =>
        tagSet.definition ? [tagSet.definition.id] : []
      )
    );
    setPropertyValues(
      reconcile(withoutTaskComposerTags(unwrap(propertyValues), tagSetIds))
    );
  };

  return {
    propertyValues,
    setPropertyValues,
    properties,
    visiblePropertyIds,
    setVisiblePropertyIds,
    availableProperties,
    addProperty,
    saveHandler,
    composerTags,
    clearComposerTags,
    createDefinitions,
  };
}
