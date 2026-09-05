import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { type Accessor, createMemo } from 'solid-js';
import { useTagOptionById, useTagSets } from './tag-sets-context';

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

/**
 * Resolves the tags already present in soup properties without initializing
 * any edit mutations. Virtual rows use this read-only model until a picker is
 * actually opened.
 *
 * `inFlightOptionIdsForDefinition` overlays an uncommitted selection. Applying
 * an entity's first tag from a set creates a property record whose id only
 * exists once the server answers, so that write cannot be reflected in the
 * cache beforehand — without the overlay the chip would appear a round trip
 * late.
 */
export function useSoupResolvedTags(
  properties: Accessor<SoupProperty[] | undefined>,
  inFlightOptionIdsForDefinition?: (
    definitionId: string
  ) => string[] | undefined
): Accessor<ResolvedTag[]> {
  const tagSets = useTagSets();
  const tagOptionById = useTagOptionById();

  return createMemo(() => {
    const resolved: ResolvedTag[] = [];
    const options = tagOptionById();
    const soupProperties = properties();

    for (const set of tagSets()) {
      const definitionId = set.definition?.id;
      if (!definitionId) continue;
      const property = soupProperties?.find(
        (candidate) => candidate.definition.id === definitionId
      );
      const value = property?.value;
      const optionIds =
        inFlightOptionIdsForDefinition?.(definitionId) ??
        (value?.type === 'SelectOption' ? value.value : undefined);
      if (!optionIds) continue;

      for (const optionId of optionIds) {
        const tagOption = options.get(optionId);
        if (!tagOption) continue;
        resolved.push({
          optionId,
          propertyDefinitionId: tagOption.option.propertyDefinitionId,
          scope: tagOption.scope,
          label: optionLabel(tagOption.option),
          color: tagOption.option.color ?? undefined,
        });
      }
    }

    return resolved;
  });
}
