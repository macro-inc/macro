import { useTagsQuery } from '@queries/properties/tags';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import {
  type Accessor,
  createContext,
  createMemo,
  type FlowComponent,
  useContext,
} from 'solid-js';

type TagSets = Accessor<TagSetResponse[]>;
type TagOption = { option: PropertyOptionResponse; scope: TagScope };
type TagSetsContextValue = {
  tagSets: TagSets;
  /** False only while the sets are still being fetched for the first time. */
  ready: Accessor<boolean>;
  optionById: Accessor<ReadonlyMap<string, TagOption>>;
};

const ALWAYS_READY = () => true;

const TagSetsContext = createContext<TagSetsContextValue>();

/** Shares loaded tag definitions with a feature subtree. */
export const TagSetsProvider: FlowComponent<{
  tagSets: TagSets;
  /** Omit when the sets are caller-owned and available from the start. */
  ready?: Accessor<boolean>;
}> = (props) => {
  const optionById = createMemo(() => {
    const options = new Map<string, TagOption>();
    for (const set of props.tagSets()) {
      for (const option of set.options) {
        options.set(option.id, { option, scope: set.scope });
      }
    }
    return options;
  });

  return (
    <TagSetsContext.Provider
      value={{
        tagSets: props.tagSets,
        ready: () => props.ready?.() ?? ALWAYS_READY(),
        optionById,
      }}
    >
      {props.children}
    </TagSetsContext.Provider>
  );
};

/** Explicit query-owning adapter for standalone tag-aware lists. */
export const TagSetsQueryProvider: FlowComponent = (props) => {
  const tagsQuery = useTagsQuery();
  // Avoid suspending on a cold query, but retain cached tags after refetch errors.
  const tagSets = (): TagSetResponse[] =>
    tagsQuery.isPending ? [] : (tagsQuery.data ?? []);
  // Fetched once, successfully or not: a failed load still lets tag-aware
  // lists run unfiltered rather than wait forever.
  const ready = () => tagsQuery.isFetched;

  return (
    <TagSetsProvider tagSets={tagSets} ready={ready}>
      {props.children}
    </TagSetsProvider>
  );
};

function useTagSetsContext(): TagSetsContextValue {
  const context = useContext(TagSetsContext);
  if (!context) {
    throw new Error('useTagSets can only be used under a TagSetsProvider');
  }

  return context;
}

/** Returns tag definitions from the nearest metadata provider. */
export function useTagSets(): TagSets {
  return useTagSetsContext().tagSets;
}

/** Whether the nearest provider's tag sets have finished their first load. */
export function useTagSetsReady(): Accessor<boolean> {
  return useTagSetsContext().ready;
}

/** Returns the provider-owned tag-option index shared by every list row. */
export function useTagOptionById() {
  return useTagSetsContext().optionById;
}
