import { useTagsQuery } from '@queries/properties/tags';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import {
  type Accessor,
  createContext,
  type FlowComponent,
  useContext,
} from 'solid-js';

type TagSets = Accessor<TagSetResponse[]>;

const TagSetsContext = createContext<TagSets>();

/** Shares loaded tag definitions with a feature subtree. */
export const TagSetsProvider: FlowComponent<{ tagSets: TagSets }> = (props) => (
  <TagSetsContext.Provider value={props.tagSets}>
    {props.children}
  </TagSetsContext.Provider>
);

/** Explicit query-owning adapter for standalone tag-aware lists. */
export const TagSetsQueryProvider: FlowComponent = (props) => {
  const tagsQuery = useTagsQuery();
  const tagSets = (): TagSetResponse[] => tagsQuery.data ?? [];

  return <TagSetsProvider tagSets={tagSets}>{props.children}</TagSetsProvider>;
};

/** Returns tag definitions from the nearest metadata provider. */
export function useTagSets(): TagSets {
  const tagSets = useContext(TagSetsContext);
  if (!tagSets) {
    throw new Error('useTagSets can only be used under a TagSetsProvider');
  }

  return tagSets;
}
