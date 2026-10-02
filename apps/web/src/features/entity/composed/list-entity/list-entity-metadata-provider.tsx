import {
  TagSetsProvider,
  TagSetsQueryProvider,
} from '@property/tags/tag-sets-context';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { Accessor, FlowComponent } from 'solid-js';

const EMPTY_TAG_SETS: TagSetResponse[] = [];

/** Provides caller-owned metadata to a ListEntity collection without queries. */
export const ListEntityMetadataProvider: FlowComponent<{
  tagSets: Accessor<TagSetResponse[]>;
}> = (props) => (
  <TagSetsProvider tagSets={props.tagSets}>{props.children}</TagSetsProvider>
);

/**
 * Satisfies ListEntity's metadata contract without loading or displaying
 * optional metadata. Use for intentionally local or static collections.
 */
export const ListEntityNoopMetadataProvider: FlowComponent = (props) => (
  <ListEntityMetadataProvider tagSets={() => EMPTY_TAG_SETS}>
    {props.children}
  </ListEntityMetadataProvider>
);

/**
 * Owns the metadata queries needed by a standalone ListEntity collection.
 * Soup lists use their soup-specific metadata provider instead.
 */
export const ListEntityMetadataQueryProvider: FlowComponent = (props) => (
  <TagSetsQueryProvider>{props.children}</TagSetsQueryProvider>
);
