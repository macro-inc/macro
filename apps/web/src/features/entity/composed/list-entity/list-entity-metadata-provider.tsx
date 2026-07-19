import {
  TagSetsProvider,
  TagSetsQueryProvider,
} from '@property/tags/tag-sets-context';
import type { Link } from '@service-email/generated/schemas';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { Accessor, FlowComponent } from 'solid-js';
import {
  EmailLinksProvider,
  EmailLinksQueryProvider,
} from './email-links-context';

const EMPTY_EMAIL_LINKS: Link[] = [];
const EMPTY_TAG_SETS: TagSetResponse[] = [];

/** Provides caller-owned metadata to a ListEntity collection without queries. */
export const ListEntityMetadataProvider: FlowComponent<{
  emailLinks: Accessor<Link[]>;
  tagSets: Accessor<TagSetResponse[]>;
}> = (props) => (
  <EmailLinksProvider links={props.emailLinks}>
    <TagSetsProvider tagSets={props.tagSets}>{props.children}</TagSetsProvider>
  </EmailLinksProvider>
);

/**
 * Satisfies ListEntity's metadata contract without loading or displaying
 * optional metadata. Use for intentionally local or static collections.
 */
export const ListEntityNoopMetadataProvider: FlowComponent = (props) => (
  <ListEntityMetadataProvider
    emailLinks={() => EMPTY_EMAIL_LINKS}
    tagSets={() => EMPTY_TAG_SETS}
  >
    {props.children}
  </ListEntityMetadataProvider>
);

/**
 * Owns the shared metadata queries required by a standalone ListEntity
 * collection. Soup lists use their soup-specific metadata provider instead.
 */
export const ListEntityMetadataQueryProvider: FlowComponent = (props) => (
  <EmailLinksQueryProvider>
    <TagSetsQueryProvider>{props.children}</TagSetsQueryProvider>
  </EmailLinksQueryProvider>
);
