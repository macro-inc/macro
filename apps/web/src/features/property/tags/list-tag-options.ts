import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';

import type { TreeTag } from './core/tag-tree';

/** A tag as list surfaces show it: the option plus its owning set. */
export type TagOptionSummary = TreeTag;

const SCOPE_ORDER: Record<TagScope, number> = { team: 0, user: 1 };

/**
 * Flattens tag sets into display order: the team set before the personal
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
