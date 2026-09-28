import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { clause } from './clause';
import type { FacetOption, FacetSelection } from './types';

/** The facet id every tag-aware view stores its selected tag option ids under. */
export const TAG_FACET_ID = 'tags';

/**
 * A tag is a select option on the property definition that owns its set, so
 * resolving a selected option id needs the definition behind it.
 */
export type TagFacetContext = {
  tagPropertyDefinitionByOptionId: ReadonlyMap<string, string>;
};

export const EMPTY_TAG_FACET_CONTEXT: TagFacetContext = {
  tagPropertyDefinitionByOptionId: new Map(),
};

export function createTagFacetContext(
  tagSets: readonly TagSetResponse[]
): TagFacetContext {
  const tagPropertyDefinitionByOptionId = new Map<string, string>();
  for (const set of tagSets) {
    for (const option of set.options) {
      tagPropertyDefinitionByOptionId.set(
        option.id,
        option.propertyDefinitionId
      );
    }
  }
  return { tagPropertyDefinitionByOptionId };
}

type TaggedItem = { properties?: SoupProperty[] };

type TagFacetOption<TItem extends TaggedItem> = FacetOption<
  TItem,
  TagFacetContext
> & {
  propertyDefinitionId: string;
  propertyOptionId: string;
};

const itemHasTag = (item: TaggedItem, optionId: string): boolean =>
  item.properties?.some(
    (property) =>
      property.value?.type === 'SelectOption' &&
      property.value.value.includes(optionId)
  ) ?? false;

/**
 * Resolves a selected tag into a server clause and a client predicate. Unknown
 * ids (a deleted tag, or a set that has not loaded yet) resolve to nothing so
 * the selection is preserved but does not filter.
 */
export function tagFacetOption<TItem extends TaggedItem>(
  optionId: string,
  context: TagFacetContext
): TagFacetOption<TItem> | undefined {
  const propertyDefinitionId =
    context.tagPropertyDefinitionByOptionId.get(optionId);
  if (!propertyDefinitionId) return undefined;

  return {
    id: optionId,
    propertyDefinitionId,
    propertyOptionId: optionId,
    clause: {
      propf: clause.eq('properties', {
        propertyId: propertyDefinitionId,
        type: 'select',
        value: optionId,
      }),
    },
    predicate: (item) => itemHasTag(item, optionId),
  };
}

/**
 * Whether a view may run its query given the tag sets' load state. A restored
 * tag selection waits for the sets so the list does not show the whole
 * collection and then narrow; once they have loaded, a selected tag that no
 * longer exists simply stops filtering rather than blocking the query.
 */
export function tagFacetReady(
  selection: FacetSelection,
  tagSetsReady: boolean
): boolean {
  return tagSetsReady || (selection[TAG_FACET_ID] ?? []).length === 0;
}
