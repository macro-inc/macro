/**
 * Lists the streamed sync's first pass keeps whole in the cache: the viewer's
 * contacts and the channels they take part in. A list's lane and its app
 * reader run one query text from one first input and continue with the
 * stream's continuation inputs, so the reader's cache lookups find exactly
 * the pages the lane wrote. Contract: docs/architecture/streamed-cache-sync.md.
 */
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { GraphqlEntityFilterAst } from '@service-storage/graphql/generated/graphql';
import { type DocumentNode, parse } from 'graphql';
import { buildGraphqlEntitySoupInput } from '../graphql/entity-input';
import {
  CHANNEL_SYNC_COVERAGE,
  CHANNELS_SYNC_LANE_ID,
  CONTACT_SYNC_COVERAGE,
  CONTACTS_SYNC_LANE_ID,
  SYNC_MINIMAL_CHANNEL_FIELDS,
} from './minimal';

/** Items per page of a synced list (Soup's maximum). */
export const SYNCED_LIST_PAGE_SIZE = 500;

const EXCLUDED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

export type SyncedListInitialInput = Record<string, unknown>;
export type SyncedListInput =
  | { initial: SyncedListInitialInput }
  | { continuation: Record<string, unknown> };
export type SyncedListVariables = { input: SyncedListInput };

/** One page, where both the stream and the reader find it (`data.user.soup`). */
export type SyncedListData<Item> = {
  user: {
    id: string;
    soup: { items: Item[]; nextCursor: string | null } | null;
  } | null;
};

export type SyncedList<Item> = {
  lane: string;
  coverage: unknown;
  /** Server-safe query text. The paged field is aliased `soup` for the stream. */
  query: string;
  /** The first page's `initial` input. */
  initial: () => SyncedListInitialInput;
  /** The page after `cursor`, as the stream continues a lane. */
  next: (cursor: string) => SyncedListInput;
  /** `query`, parsed once for the reader. */
  document: () => TypedDocumentNode<SyncedListData<Item>, SyncedListVariables>;
};

function lazyDocument<Item>(query: string) {
  let document: DocumentNode | undefined;
  return () => {
    document ??= parse(query);
    return document as TypedDocumentNode<
      SyncedListData<Item>,
      SyncedListVariables
    >;
  };
}

/** Every Soup branch excluded; a list's filter then includes its own branch. */
export function excludedSoupFilters(): GraphqlEntityFilterAst {
  const input = buildGraphqlEntitySoupInput('DOCUMENT', EXCLUDED_ENTITY_ID);
  const filters = input && 'initial' in input ? input.initial?.filters : null;
  if (!filters) throw new Error('cannot build the Soup exclusion filter');
  return filters;
}

/**
 * Channels only, with no channel filter: Soup then lists the channels the
 * viewer actively takes part in, the set `GET /comms/channels` returns.
 */
export function channelSoupFilters(): GraphqlEntityFilterAst {
  const { channelFilter: _excluded, ...filters } = excludedSoupFilters();
  return filters;
}

/** A contact as the reader gets it: the contact's Macro user id. */
export type SyncedContact = { __typename: 'GraphqlContact'; id: string };

const CONTACTS_QUERY = `query SyncContacts($input: ContactsInput!) {
  user { id soup: contacts(input: $input) { items { __typename id } nextCursor } }
}`;

export const CONTACTS_SYNC: SyncedList<SyncedContact> = {
  lane: CONTACTS_SYNC_LANE_ID,
  coverage: CONTACT_SYNC_COVERAGE,
  query: CONTACTS_QUERY,
  initial: () => ({ limit: SYNCED_LIST_PAGE_SIZE }),
  next: (cursor) => ({ continuation: { cursor } }),
  document: lazyDocument(CONTACTS_QUERY),
};

/** Contacts ids for the `contacts-ids` membership lane. */
export const CONTACT_IDS_QUERY = CONTACTS_QUERY.replace(
  'query SyncContacts',
  'query SyncContactIds'
);

/** A channel row with the minimal channel fields. */
export type SyncedChannel = {
  __typename: string;
  id: string;
  name?: string | null;
  channelType?: string;
  ownerId?: string;
  organizationId?: string | null;
  teamId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  viewedAt?: string | null;
  interactedAt?: string | null;
  isParticipant?: boolean;
  autoJoinTeam?: boolean;
  frecencyScore?: number | null;
  agentDm?: {
    botId: string;
    name: string;
    avatarUrl?: string | null;
  } | null;
  participants?: Array<{
    channelId: string;
    userId: string;
    role: string;
    joinedAt: string;
    leftAt?: string | null;
  }>;
};

/**
 * `SoupBackfillSync…`: the cache rejects a page whose channel rows would be
 * incomplete for local filtering.
 */
const CHANNELS_QUERY = `query SoupBackfillSyncChannels($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        ${SYNC_MINIMAL_CHANNEL_FIELDS}
      }
      nextCursor
    }
  }
}`;

export const CHANNELS_SYNC: SyncedList<SyncedChannel> = {
  lane: CHANNELS_SYNC_LANE_ID,
  coverage: CHANNEL_SYNC_COVERAGE,
  query: CHANNELS_QUERY,
  // Creation order never changes mid-scan, so a channel cannot be skipped.
  initial: () => ({
    limit: SYNCED_LIST_PAGE_SIZE,
    expand: true,
    sortMethod: 'CREATED_AT',
    filters: channelSoupFilters(),
  }),
  // The stream carries `expand` (and `emailView` / `sortDirection`, unset
  // here) from the first input into every continuation.
  next: (cursor) => ({ continuation: { cursor, expand: true } }),
  document: lazyDocument(CHANNELS_QUERY),
};
