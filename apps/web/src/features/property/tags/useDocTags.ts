import {
  useAddEntityPropertyOptionMutation,
  useRemoveEntityPropertyOptionMutation,
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
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import { useEntityProperties } from '../hooks';
import type { PropertyDefinitionDomain } from '../types';

export type ResolvedTag = {
  optionId: string;
  propertyDefinitionId: string;
  scope: TagScope;
  label: string;
  color?: string;
};

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
    valueType: 'SELECT_STRING',
    isMultiSelect: true,
    isMetadata: definition.isMetadata,
    isSystem: definition.isSystem,
    owner: definition,
    createdAt: definition.createdAt ?? new Date().toISOString(),
    updatedAt: definition.updatedAt ?? new Date().toISOString(),
  };
}

function createDocTags(
  entityId: string,
  entityType: EntityType,
  appliedOptionIdsForDefinition: (definitionId: string) => string[]
) {
  const tagsQuery = useTagsQuery();
  const ensureTagSet = useEnsureTagSetMutation();
  const addOption = useAddEntityPropertyOptionMutation();
  const removeOption = useRemoveEntityPropertyOptionMutation();
  const [pendingOptionIdsByDefinition, setPendingOptionIdsByDefinition] =
    createSignal<Map<string, string[]>>(new Map());
  const [displayOptionOrder, setDisplayOptionOrder] = createSignal<string[]>(
    []
  );

  const tagSets = (): TagSetResponse[] => tagsQuery.data ?? [];

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
    pendingOptionIdsByDefinition().get(definitionId) ??
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

  createEffect(() => {
    const pending = pendingOptionIdsByDefinition();
    if (pending.size === 0) return;

    let changed = false;
    const next = new Map(pending);
    for (const [definitionId, pendingIds] of pending) {
      const sourceIds = appliedOptionIdsForDefinition(definitionId);
      if (sameOptionIds(sourceIds, pendingIds)) {
        next.delete(definitionId);
        changed = true;
      }
    }

    if (changed) {
      setPendingOptionIdsByDefinition(next);
    }
  });

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

  const applyTag = async (scope: TagScope, optionId: string) => {
    const definition = await resolveDefinition(scope);
    const current = appliedOptionIdsForDefinition(definition.id);
    if (current.includes(optionId)) return;
    await addOption.mutateAsync({
      entityId,
      entityType,
      property: definitionDomain(definition),
      optionId,
      optimisticOptionIds: [...current, optionId],
    });
  };

  const removeTag = async (scope: TagScope, optionId: string) => {
    const definition = definitionByScope().get(scope);
    if (!definition) return;
    const current = appliedOptionIdsForDefinition(definition.id);
    if (!current.includes(optionId)) return;
    await removeOption.mutateAsync({
      entityId,
      entityType,
      property: definitionDomain(definition),
      optionId,
      optimisticOptionIds: current.filter((id) => id !== optionId),
    });
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

    const currentDefinition = definitionByScope().get(currentTag.scope);
    const nextDefinition = await resolveDefinition(nextScope);
    if (!currentDefinition) return;

    const previousOverrides = pendingOptionIdsByDefinition();
    const previousDisplayOrder = displayOptionOrder();
    const currentIds = visibleOptionIdsForDefinition(currentDefinition.id);
    const nextIds = visibleOptionIdsForDefinition(nextDefinition.id);

    setDisplayOptionOrder(
      appliedTags().map((tag) =>
        tag.optionId === currentTag.optionId ? nextOptionId : tag.optionId
      )
    );

    setPendingOptionIdsByDefinition((prev) => {
      const next = new Map(prev);
      next.set(
        currentDefinition.id,
        currentIds.filter((id) => id !== currentTag.optionId)
      );
      if (currentDefinition.id === nextDefinition.id) {
        next.set(
          currentDefinition.id,
          currentIds.map((id) =>
            id === currentTag.optionId ? nextOptionId : id
          )
        );
      } else if (!nextIds.includes(nextOptionId)) {
        next.set(nextDefinition.id, [...nextIds, nextOptionId]);
      }
      return next;
    });

    try {
      await removeTag(currentTag.scope, currentTag.optionId);
      if (
        !appliedOptionIdsForDefinition(nextDefinition.id).includes(nextOptionId)
      ) {
        await applyTag(nextScope, nextOptionId);
      }
    } catch (error) {
      setPendingOptionIdsByDefinition(previousOverrides);
      setDisplayOptionOrder(previousDisplayOrder);
      throw error;
    }
  };

  return {
    tagsQuery,
    tagSets,
    appliedTags,
    optionById,
    isApplied,
    applyTag,
    removeTag,
    replaceTag,
    toggleTag,
  };
}

export function useDocTags(entityId: string, entityType: EntityType) {
  const { properties } = useEntityProperties(entityId, entityType, false);

  return createDocTags(entityId, entityType, (definitionId) => {
    const property = properties().find(
      (prop) => prop.propertyDefinitionId === definitionId
    );
    if (!property) return [];
    return property.valueType === 'SELECT_STRING' && property.value
      ? property.value
      : [];
  });
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
  return createDocTags(entityId, entityType, (definitionId) => {
    const property = properties()?.find(
      (prop) => prop.definition.id === definitionId
    );
    const value = property?.value;
    return value?.type === 'SelectOption' ? value.value : [];
  });
}
