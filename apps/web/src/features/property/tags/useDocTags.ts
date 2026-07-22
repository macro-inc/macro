import {
  useBulkUpdateEntityPropertyOptionsMutation,
  useInFlightEntityPropertyOptions,
} from '@queries/properties/entity';
import {
  useEnsureTagSetMutation,
  useTagsQuery,
} from '@queries/properties/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinitionDetailResponse } from '@service-properties/generated/schemas/propertyDefinitionDetailResponse';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { useEntityProperties } from '../hooks';
import type { PropertyDefinitionDomain } from '../types';
import { useTagSets } from './tag-sets-context';
import type { ResolvedTag } from './useSoupResolvedTags';

export type { ResolvedTag } from './useSoupResolvedTags';

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function sameOptionIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

function definitionDomain(
  definition: PropertyDefinitionDetailResponse
): PropertyDefinitionDomain {
  return {
    id: definition.id,
    displayName: definition.displayName,
    valueType: 'TAG',
    isMultiSelect: true,
    isMetadata: definition.isMetadata,
    isSystem: definition.isSystem,
    owner: definition,
    createdAt: definition.createdAt ?? new Date().toISOString(),
    updatedAt: definition.updatedAt ?? new Date().toISOString(),
  };
}

type TagSelectionUpdate = {
  definition: PropertyDefinitionDetailResponse;
  currentOptionIds: string[];
  nextOptionIds: string[];
};

type PersistTagSelection = (
  updates: TagSelectionUpdate[]
) => Promise<void> | void;

type SetTagOptionIdsForDefinition = (
  definition: PropertyDefinitionDetailResponse,
  optionIds: string[]
) => Promise<void> | void;

function usePersistTagSelection(
  entityId: string,
  entityType: EntityType
): PersistTagSelection {
  const mutation = useBulkUpdateEntityPropertyOptionsMutation(entityId);

  return async (updates) => {
    await mutation.mutateAsync({
      entityId,
      entityType,
      properties: updates.map((update) => ({
        property: definitionDomain(update.definition),
        currentOptionIds: update.currentOptionIds,
        nextOptionIds: update.nextOptionIds,
      })),
    });
  };
}

function createDocTags(
  appliedOptionIdsForDefinition: (definitionId: string) => string[],
  persistTagSelection: PersistTagSelection,
  tagSets: Accessor<TagSetResponse[]>,
  // Optimistic overlay for query-backed sources (undefined for soup/local,
  // whose sources update optimistically on their own).
  inFlightOptionIdsForDefinition?: (
    definitionId: string
  ) => string[] | undefined
) {
  const ensureTagSet = useEnsureTagSetMutation();
  const [displayOptionOrder, setDisplayOptionOrder] = createSignal<string[]>(
    []
  );

  const definitionByScope = createMemo(() => {
    const map = new Map<TagScope, PropertyDefinitionDetailResponse>();
    for (const set of tagSets()) {
      if (set.definition) map.set(set.scope, set.definition);
    }
    return map;
  });

  const optionById = createMemo(() => {
    const map = new Map<string, ResolvedTag>();
    for (const set of tagSets()) {
      for (const option of set.options) {
        map.set(option.id, {
          optionId: option.id,
          propertyDefinitionId: option.propertyDefinitionId,
          scope: set.scope,
          label: optionLabel(option),
          color: option.color ?? undefined,
        });
      }
    }
    return map;
  });

  const visibleOptionIdsForDefinition = (definitionId: string): string[] =>
    inFlightOptionIdsForDefinition?.(definitionId) ??
    appliedOptionIdsForDefinition(definitionId);

  const visibleTags = createMemo((): ResolvedTag[] => {
    const resolved: ResolvedTag[] = [];
    const lookup = optionById();
    for (const definition of definitionByScope().values()) {
      for (const optionId of visibleOptionIdsForDefinition(definition.id)) {
        const tag = lookup.get(optionId);
        if (tag) resolved.push(tag);
      }
    }
    return resolved;
  });

  const appliedTags = createMemo((): ResolvedTag[] => {
    const tags = visibleTags();
    const order = displayOptionOrder();
    if (order.length === 0) return tags;

    const byId = new Map(tags.map((tag) => [tag.optionId, tag]));
    const ordered: ResolvedTag[] = [];
    for (const optionId of order) {
      const tag = byId.get(optionId);
      if (tag) {
        ordered.push(tag);
        byId.delete(optionId);
      }
    }
    return [...ordered, ...byId.values()];
  });

  const isApplied = (optionId: string): boolean =>
    appliedTags().some((tag) => tag.optionId === optionId);

  const resolveDefinition = async (
    scope: TagScope
  ): Promise<PropertyDefinitionDetailResponse> => {
    const existing = definitionByScope().get(scope);
    if (existing) return existing;
    const provisioned = await ensureTagSet.mutateAsync({ scope });
    if (!provisioned.definition) {
      throw new Error(`Tag set for scope "${scope}" has no definition`);
    }
    return provisioned.definition;
  };

  // Optimism and rollback live in the persistence layer: the soup/local sources
  // update optimistically, and the query source reads the in-flight overlay
  // above. A failed commit persists nothing and leaves no in-flight state, so
  // there is nothing to unwind here.
  const commitTagSelection = async (updates: TagSelectionUpdate[]) => {
    if (updates.length === 0) return;
    await persistTagSelection(updates);
  };

  const applyTag = async (scope: TagScope, optionId: string) => {
    const definition = await resolveDefinition(scope);
    const currentOptionIds = visibleOptionIdsForDefinition(definition.id);
    if (currentOptionIds.includes(optionId)) return;
    await commitTagSelection([
      {
        definition,
        currentOptionIds,
        nextOptionIds: [...currentOptionIds, optionId],
      },
    ]);
  };

  const removeTag = async (scope: TagScope, optionId: string) => {
    const definition = definitionByScope().get(scope);
    if (!definition) return;
    const currentOptionIds = visibleOptionIdsForDefinition(definition.id);
    if (!currentOptionIds.includes(optionId)) return;
    await commitTagSelection([
      {
        definition,
        currentOptionIds,
        nextOptionIds: currentOptionIds.filter((id) => id !== optionId),
      },
    ]);
  };

  const setTagSelection = async (selectedOptionIds: ReadonlySet<string>) => {
    const options = optionById();
    const updates = [...definitionByScope().values()].flatMap((definition) => {
      const currentOptionIds = visibleOptionIdsForDefinition(definition.id);
      const nextOptionIds = [...selectedOptionIds].filter(
        (optionId) =>
          options.get(optionId)?.propertyDefinitionId === definition.id
      );

      return sameOptionIds(currentOptionIds, nextOptionIds)
        ? []
        : [{ definition, currentOptionIds, nextOptionIds }];
    });
    await commitTagSelection(updates);
  };

  const toggleTag = async (scope: TagScope, optionId: string) => {
    if (isApplied(optionId)) {
      await removeTag(scope, optionId);
    } else {
      await applyTag(scope, optionId);
    }
  };

  const replaceTag = async (
    currentTag: ResolvedTag,
    nextScope: TagScope,
    nextOptionId: string
  ) => {
    if (currentTag.optionId === nextOptionId) return;

    await resolveDefinition(nextScope);
    const previousDisplayOrder = displayOptionOrder();
    const nextSelection = new Set(
      appliedTags().map((tag) =>
        tag.optionId === currentTag.optionId ? nextOptionId : tag.optionId
      )
    );

    setDisplayOptionOrder([...nextSelection]);

    try {
      await setTagSelection(nextSelection);
    } catch (error) {
      setDisplayOptionOrder(previousDisplayOrder);
      throw error;
    }
  };

  return {
    tagSets,
    appliedTags,
    optionById,
    isApplied,
    applyTag,
    removeTag,
    replaceTag,
    setTagSelection,
    toggleTag,
  };
}

export function useDocTags(entityId: string, entityType: EntityType) {
  const { properties } = useEntityProperties(entityId, entityType, false);
  const appliedOptionIdsForDefinition = (definitionId: string) => {
    const property = properties().find(
      (prop) => prop.propertyDefinitionId === definitionId
    );
    if (!property) return [];
    return property.valueType === 'SELECT_STRING' && property.value
      ? property.value
      : [];
  };
  const persistTagSelection = usePersistTagSelection(entityId, entityType);
  const tagsQuery = useTagsQuery();
  const tagSets = (): TagSetResponse[] => tagsQuery.data ?? [];
  // The properties query isn't optimistically written, so surface in-flight
  // bulk updates as the optimistic value until the refetch lands.
  const inFlightOptionIdsForDefinition =
    useInFlightEntityPropertyOptions(entityId);

  return createDocTags(
    appliedOptionIdsForDefinition,
    persistTagSelection,
    tagSets,
    inFlightOptionIdsForDefinition
  );
}

/**
 * Doc-tags backed by an entity's already-loaded soup properties instead of a
 * per-entity fetch. List rows use this so tags render with no extra requests.
 * Mutations patch the soup cache optimistically, so the source stays live.
 */
export function useSoupDocTags(
  entityId: string,
  entityType: EntityType,
  properties: Accessor<SoupProperty[] | undefined>
) {
  const appliedOptionIdsForDefinition = (definitionId: string) => {
    const property = properties()?.find(
      (prop) => prop.definition.id === definitionId
    );
    const value = property?.value;
    return value?.type === 'SelectOption' ? value.value : [];
  };
  const persistTagSelection = usePersistTagSelection(entityId, entityType);
  const tagSets = useTagSets();

  return createDocTags(
    appliedOptionIdsForDefinition,
    persistTagSelection,
    tagSets
  );
}

export function useLocalDocTags(
  appliedOptionIdsForDefinition: (definitionId: string) => string[],
  setTagOptionIdsForDefinition: SetTagOptionIdsForDefinition
) {
  const tagsQuery = useTagsQuery();
  const tagSets = (): TagSetResponse[] => tagsQuery.data ?? [];

  return createDocTags(
    appliedOptionIdsForDefinition,
    async (updates) => {
      await Promise.all(
        updates.map((update) =>
          setTagOptionIdsForDefinition(update.definition, update.nextOptionIds)
        )
      );
    },
    tagSets
  );
}
