import { matchesTokenSubsequences } from '@core/util/string';
import type { CrmContactEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { mergeDiscoveredContacts } from '../core/contact-discovery';

/** Contacts the local cache matches for the live query. */
export type CachedContactMatches = {
  contacts: Accessor<CrmContactEntity[]>;
  isLoading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

/** Loaded server rows and the query they answer. */
export type ServerAnswer = { query: string; contacts: CrmContactEntity[] };

/** Authorized server pages for `query`, which trails the live query. */
export type ServerContactPages = {
  query: Accessor<string>;
  /** Loaded pages and the query they answer, read from the pages themselves;
   * undefined until a first page settles. */
  answer: Accessor<ServerAnswer | undefined>;
  error: Accessor<Error | undefined>;
  isLoading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** Rows answering an earlier query show only while the cache's matching
 * semantics still match them against the live query by name or email. */
const stillMatches = (contact: CrmContactEntity, query: string) =>
  matchesTokenSubsequences(`${contact.name} | ${contact.email}`, query);

const NO_ANSWER: ServerAnswer = { query: '', contacts: [] };

// Bounds one request for more rows when consecutive pages hold only
// duplicates of contacts already shown.
const MAX_PAGES_PER_LOAD = 5;

/**
 * Contacts matching a typed query: cached matches immediately, server pages
 * for contacts the cache has not seen. Nothing is exposed or paged while
 * inactive, and rows from an earlier query only show while they still match.
 */
export function createContactDiscovery(options: {
  query: Accessor<string>;
  active: Accessor<boolean>;
  cached: CachedContactMatches;
  server: ServerContactPages;
}) {
  const query = () => options.query().trim();
  const searching = () => options.active() && query().length > 0;
  const serverSettled = () => options.server.query() === query();

  // A newer query's first page replaces the last answer only once it lands,
  // so typing does not blank rows that still match.
  const serverAnswer = createMemo<ServerAnswer>(
    (previous) =>
      searching() ? (options.server.answer() ?? previous) : NO_ANSWER,
    NO_ANSWER
  );

  const serverContacts = () => {
    const answer = serverAnswer();
    return answer.query === query()
      ? answer.contacts
      : answer.contacts.filter((contact) => stillMatches(contact, query()));
  };

  const contacts = createMemo<CrmContactEntity[]>(() =>
    searching()
      ? mergeDiscoveredContacts(options.cached.contacts(), serverContacts())
      : []
  );

  const canLoadServer = () =>
    searching() && serverSettled() && options.server.hasMore();
  const canLoadCached = () => searching() && options.cached.hasMore();
  const hasMore = () => canLoadServer() || canLoadCached();

  const loadPage = async () => {
    await Promise.all([
      canLoadServer() && !options.server.isLoadingMore()
        ? options.server.loadMore()
        : undefined,
      canLoadCached() && !options.cached.isLoadingMore()
        ? options.cached.loadMore()
        : undefined,
    ]);
  };

  const loadUntilNewContact = async () => {
    const startQuery = query();
    const startCount = contacts().length;
    for (let page = 0; page < MAX_PAGES_PER_LOAD; page++) {
      await loadPage();
      if (
        query() !== startQuery ||
        !hasMore() ||
        contacts().length > startCount
      )
        return;
    }
  };

  let pending: Promise<void> | undefined;
  const loadMore = async () => {
    if (pending) return pending;
    if (!hasMore()) return;
    pending = loadUntilNewContact();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  };

  return {
    contacts,
    isLoading: () =>
      searching() &&
      contacts().length === 0 &&
      (!serverSettled() ||
        options.server.isLoading() ||
        options.cached.isLoading()),
    error: () => (searching() ? options.server.error() : undefined),
    hasMore,
    isLoadingMore: () =>
      searching() &&
      (options.server.isLoadingMore() || options.cached.isLoadingMore()),
    loadMore,
    refresh: async () => {
      if (searching()) await options.server.refresh();
    },
  };
}

export type ContactDiscovery = ReturnType<typeof createContactDiscovery>;
