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
import { createMemo } from 'solid-js';
import { useEntityProperties } from '../hooks';
import type { PropertyDefinitionDomain } from '../types';

export type ResolvedTag = {
  optionId: string;
  scope: TagScope;
  label: string;
  color?: string;
};

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
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

export function useDocTags(entityId: string, entityType: EntityType) {
  const tagsQuery = useTagsQuery();
  const ensureTagSet = useEnsureTagSetMutation();
  const addOption = useAddEntityPropertyOptionMutation();
  const removeOption = useRemoveEntityPropertyOptionMutation();
  const { properties } = useEntityProperties(entityId, entityType, false);

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
          scope: set.scope,
          label: optionLabel(option),
          color: option.color ?? undefined,
        });
      }
    }
    return map;
  });

  const appliedOptionIdsForDefinition = (definitionId: string): string[] => {
    const property = properties().find(
      (prop) => prop.propertyDefinitionId === definitionId
    );
    if (!property) return [];
    return property.valueType === 'SELECT_STRING' && property.value
      ? property.value
      : [];
  };

  const appliedTags = createMemo((): ResolvedTag[] => {
    const resolved: ResolvedTag[] = [];
    const lookup = optionById();
    for (const definition of definitionByScope().values()) {
      for (const optionId of appliedOptionIdsForDefinition(definition.id)) {
        const tag = lookup.get(optionId);
        if (tag) resolved.push(tag);
      }
    }
    return resolved;
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

  return {
    tagsQuery,
    tagSets,
    appliedTags,
    optionById,
    isApplied,
    applyTag,
    removeTag,
    toggleTag,
  };
}
