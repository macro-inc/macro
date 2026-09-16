import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo } from 'solid-js';
import { useTagSets } from './tag-sets-context';

/** A tag as list surfaces show it: the option plus the set it belongs to. */
export type TagOptionSummary = {
  id: string;
  label: string;
  color?: string;
  scope: TagScope;
  propertyDefinitionId: string;
};

const SCOPE_ORDER: Record<TagScope, number> = { user: 0, team: 1 };

/**
 * Flattens tag sets into display order: the personal set before the team
 * set, each in the order the user arranged it in Settings.
 */
export function listTagOptions(
  tagSets: readonly TagSetResponse[]
): TagOptionSummary[] {
  return [...tagSets]
    .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
    .flatMap((set) =>
      [...set.options]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(
          (option): TagOptionSummary => ({
            id: option.id,
            label:
              option.value.type === 'string' ? option.value.value : option.id,
            color: option.color ?? undefined,
            scope: set.scope,
            propertyDefinitionId: option.propertyDefinitionId,
          })
        )
    );
}

/** The provider's tag sets in display order. */
export function useTagOptions(): Accessor<TagOptionSummary[]> {
  const tagSets = useTagSets();
  return createMemo(() => listTagOptions(tagSets()));
}
