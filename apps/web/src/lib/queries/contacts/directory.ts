import {
  enableNamedContactSearch,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { IUser } from '@core/user/types';
import { normalizeNameText, startsWordsOf } from '@core/util/name-match-score';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  PEOPLE_MIN_POLICY_VERSION,
  PEOPLE_POLICY_VERSION,
  type PeopleSearch,
  type PeopleSearchResult,
} from '@graphql-cache/people/generated';
import type { PeopleCache } from '@graphql-cache/people/host';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { ContactDirectoryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  fetchContactDirectoryByIds,
  fetchContactDirectoryPage,
  fetchContactNamedPeople,
  fetchContactReferencePage,
} from '@service-storage/graphql-contacts';
import { hashKey } from '@tanstack/solid-query';
import { loadContactCheckpoint } from './backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';
import { canonicalContactUserId } from './contact-user-id';
import type { ContactListPriority } from './list-priority';

export { ContactDirectoryScopeError } from './cache-scope';
export const CONTACT_WINDOW_SIZE = 50;

/** Offline without a usable local cache; hydration or context publication can
 * make a later local read available. */
export class ContactDirectoryUnavailableError extends Error {
  constructor() {
    super(
      'Local contact search is unavailable; wait for synchronization or retry'
    );
  }
}

export type ContactDirectoryCursor =
  | {
      source: 'people';
      userId: string;
      query: string;
      generation: string;
      after: string;
      policyKey: string;
    }
  | {
      source: 'server';
      userId: string;
      query: string;
      after: string;
      policyKey: string;
      /** Continues a window the server listed because the cache was late. */
      localLate?: boolean;
    };
export type ContactPeoplePolicy = Pick<
  PeopleSearch,
  'mode' | 'excluded' | 'senderDomain' | 'onlyListed'
> & {
  /** Orders people by contact list; see `PeopleSearch.listPriority`. On
   * policy 8 the group decides before exact over word-prefix among names that
   * start with the query; policy 7 hosts rank within each name stage, and
   * their windows are kept as they come. Only a host on policy 7 or later
   * reads it: older hosts keep their order, and `onlyListed` drops nobody
   * there. */
  listPriority?: ContactListPriority;
};
export type RankedPerson = Extract<
  PeopleSearchResult,
  { kind: 'page' }
>['people'][number];
export type ContactDirectoryRequest = {
  query: string;
  limit?: number;
  cursor?: ContactDirectoryCursor;
  policy?: ContactPeoplePolicy;
  /** How long a first page waits for the local cache before the server is
   * read instead. Without it the read waits for the cache however long it
   * takes. */
  localBudgetMs?: number;
  /** Members of the viewer's team. The server does not rank its pages, so a
   * server page reads the teammates a typed search names, up to 500 of them,
   * and lists them among the first rows. */
  teammates?: readonly string[];
};
export type ContactDirectoryPage = {
  users: IUser[];
  people?: RankedPerson[];
  /** On the first server page of a typed search: the listed people the text
   * names, who lead `users`. `exact` by whole name, first name or address;
   * `wordStart` by a word of their name starting with each typed word, or by
   * their address starting with the typed part of one. */
  named?: { exact: string[]; wordStart: string[] };
  query: string;
  source: 'cache' | 'server';
  sync: 'cold' | 'partial' | 'snapshot' | 'unavailable';
  offline: boolean;
  /** The server answered because the cache did not within the request's
   * budget; the cache may still be usable for a later read. */
  localLate?: boolean;
  nextCursor: ContactDirectoryCursor | null;
};
export type ContactDirectoryHost = Pick<
  CacheHost,
  | 'people'
  | 'clientId'
  | 'disabled'
  | 'currentStorageGeneration'
  | 'readQuery'
  | 'readRecordsByKeys'
>;

/** Already-resolved scalar labels, not entries in the global display-name store. */
export function contactToUser(contact: ContactDirectoryFieldsFragment): IUser {
  return {
    id: contact.userId,
    email: contact.email,
    name: contact.name ?? (contact.email.split('@')[0] || contact.email),
  };
}

/** Interactive suggestions read the local indexed projection; incomplete
 * hydration is an explicit partial window. Only when this tab has no usable
 * local cache, and is online, do they read bounded server pages instead. */
export async function readContactDirectory(
  viewer: string,
  host: ContactDirectoryHost | undefined,
  request: ContactDirectoryRequest,
  signal: AbortSignal,
  online = typeof navigator === 'undefined' || navigator.onLine
): Promise<ContactDirectoryPage> {
  return Telemetry.span('contacts.read_window', async (span) => {
    signal.throwIfAborted();
    const limit = request.limit ?? CONTACT_WINDOW_SIZE;
    const policy: ContactPeoplePolicy = request.policy ?? {
      mode: 'property',
      excluded: [],
    };
    if (!viewer || !isBoundedWindow(request.query, limit, policy))
      throw new Error('Invalid contact window');
    const policyKey = hashKey([policy]);
    if (
      request.cursor &&
      (request.cursor.userId !== viewer ||
        request.cursor.query !== request.query ||
        request.cursor.policyKey !== policyKey)
    )
      throw new ContactDirectoryScopeError();
    span.setAttr('contacts.query_length', request.query.length);
    span.setAttr('contacts.limit', limit);
    span.setAttr('contacts.mode', policy.mode);
    // Pickers read further pages by themselves as their lists scroll.
    span.setAttr('contacts.continuation', !!request.cursor);
    const input = {
      viewer,
      request,
      policy,
      policyKey,
      limit,
      signal,
      online,
      span,
    };
    // A server continuation keeps paging the server; a cache change or a new
    // query restarts the window, which then tries the local cache first.
    const local =
      request.cursor?.source === 'server'
        ? undefined
        : await readLocalWithinBudget(host, input);
    const cacheLate = local === 'late' || local === 'failed';
    if (cacheLate) span.setAttr('contacts.local', local);
    if (!local && !online) throw new ContactDirectoryUnavailableError();
    // The read may have been superseded while it waited for the cache.
    signal.throwIfAborted();
    const page =
      local && !cacheLate
        ? local
        : await readLateAwareServerWindow(input, cacheLate);
    span.setAttr('contacts.source', page.source);
    span.setAttr('contacts.sync', page.sync);
    span.setAttr('contacts.result_count', page.users.length);
    return page;
  });
}

/** Whether a request fits the transport's input bounds. */
function isBoundedWindow(
  query: string,
  limit: number,
  policy: ContactPeoplePolicy
): boolean {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  return (
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 500 &&
    bytes(query) <= 512 &&
    policy.excluded.length <= 500 &&
    policy.excluded.every((id) => bytes(id) <= 1024) &&
    (policy.senderDomain == null || bytes(policy.senderDomain) <= 255) &&
    isBoundedListPriority(policy.listPriority ?? [], bytes)
  );
}

/** The cache-core host's bounds for a list order (`people.rs`): it refuses
 * the whole search past them. */
const MAX_LIST_GROUPS = 16;
const MAX_LIST_KEYS = 64;
const MAX_LIST_KEY_BYTES = 128;

function isBoundedListPriority(
  groups: ContactListPriority,
  bytes: (value: string) => number
): boolean {
  const keys = groups.flat();
  return (
    groups.length <= MAX_LIST_GROUPS &&
    keys.length <= MAX_LIST_KEYS &&
    keys.every((key) => key.length > 0 && bytes(key) <= MAX_LIST_KEY_BYTES)
  );
}

/** Typed text, normalized, with the person it identifies when it is a whole
 * address or user ID. */
type TypedText = { text: string; identity?: string };

function typedText(query: string): TypedText {
  const text = normalizeNameText(query);
  if (!text.includes('@')) return { text };
  const id = text.startsWith('macro|') ? text : `macro|${text}`;
  return { text, identity: canonicalContactUserId(id) };
}

/** How typed text names a person, as the leading stages of the local ranking
 * decide it: a whole address by the one person it identifies, part of an
 * address by the addresses it starts, a name by the whole name or first name
 * it equals, or by starting a word of the name with each typed word. */
function namedBy(
  { text, identity }: TypedText,
  user: IUser
): 'exact' | 'wordStart' | undefined {
  // No text names nobody, whatever a blank name would equal.
  if (!text) return undefined;
  if (identity) return user.id.toLowerCase() === identity ? 'exact' : undefined;

  if (text.includes('@'))
    return user.email.toLowerCase().startsWith(text) ? 'wordStart' : undefined;

  const name = normalizeNameText(user.name);
  const firstName = !text.includes(' ') && !name.includes(',');
  if (name === text || (firstName && name.split(' ')[0] === text))
    return 'exact';
  // Punctuation alone holds no word, and no words start every name.
  if (!/[\p{Alphabetic}\p{Number}]/u.test(text)) return undefined;
  return startsWordsOf(user.name, text) ? 'wordStart' : undefined;
}

/** How far contact hydration has progressed for this storage generation. */
function localSync(
  viewer: string,
  generation: string,
  resultCount: number
): ContactDirectoryPage['sync'] {
  const checkpoint = loadContactCheckpoint(viewer, generation);
  if (checkpoint.completedAt !== null) return 'snapshot';
  return checkpoint.pages || resultCount ? 'partial' : 'cold';
}

type WindowInput = {
  viewer: string;
  request: ContactDirectoryRequest;
  policy: ContactPeoplePolicy;
  policyKey: string;
  limit: number;
  signal: AbortSignal;
  online: boolean;
  span: Span;
};

/** The local window, unless a first page with a budget gets no answer from
 * the cache in time: a busy cache, or one changing owner, can hold a read for
 * many seconds or fail it, and the caller reads the server instead. The
 * abandoned read still finishes in the engine. */
async function readLocalWithinBudget(
  host: ContactDirectoryHost | undefined,
  input: WindowInput
): Promise<ContactDirectoryPage | undefined | 'late' | 'failed'> {
  // Offline there is no server to read instead, so the cache is waited for.
  const budget = input.request.localBudgetMs;
  if (budget === undefined || input.request.cursor || !input.online)
    return readLocalWindow(host, input);

  const settle = async () => {
    try {
      return { page: await readLocalWindow(host, input) };
    } catch (error) {
      return { error };
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), budget);
  });
  const first = await Promise.race([settle(), late]);
  clearTimeout(timer);
  if (first === 'late') return 'late';
  if (!('error' in first)) return first.page;
  // A continuation or scope mismatch, and a superseded read, are not the
  // cache failing to answer.
  if (first.error instanceof ContactDirectoryScopeError || input.signal.aborted)
    throw first.error;
  return 'failed';
}

/** The list fields of a people search, present only when a policy sets them. */
type ListOrder = Pick<PeopleSearch, 'listPriority' | 'onlyListed'>;

/** The first people policy that reads a list order. */
const LIST_ORDER_POLICY_VERSION = 7;

/** The people policy each cache host last answered a search with. A host
 * tells its policy only in its answers, and hosts on policy 5 and 6 (native
 * builds before the release that brings 7) refuse any search carrying list
 * fields, so a list order is sent only to a host that has answered with 7 or
 * later. A page's host keeps its policy for the life of the page. */
const answeredPolicies = new WeakMap<PeopleCache, number>();

function listOrder(policy: ContactPeoplePolicy): ListOrder | undefined {
  const groups = policy.listPriority ?? [];
  if (!groups.length && !policy.onlyListed) return undefined;
  return {
    ...(groups.length
      ? { listPriority: groups.map((group) => [...group]) }
      : {}),
    ...(policy.onlyListed ? { onlyListed: true } : {}),
  };
}

/** Searches with the policy's list order when the host reads one. The first
 * search on a host whose policy is not yet known goes without it; if the host
 * answers with policy 7 or later, the search is sent again with the order, so
 * the first window a picker shows is already ordered by list. */
async function searchWithListOrder(
  people: PeopleCache,
  policy: ContactPeoplePolicy,
  search: (lists: ListOrder | undefined) => ReturnType<PeopleCache['search']>,
  span: Span
): ReturnType<PeopleCache['search']> {
  const lists = listOrder(policy);
  const known = answeredPolicies.get(people) ?? 0;
  const sendsLists = !!lists && known >= LIST_ORDER_POLICY_VERSION;
  const first = await search(sendsLists ? lists : undefined);
  const resend =
    !!lists &&
    !sendsLists &&
    first.kind === 'page' &&
    first.policyVersion >= LIST_ORDER_POLICY_VERSION;
  const result = resend ? await search(lists) : first;
  if (result.kind === 'page') {
    answeredPolicies.set(people, result.policyVersion);
    span.setAttr('contacts.policy_version', result.policyVersion);
  }
  if (lists) {
    // A host that has not answered with a page has told no policy yet.
    let outcome = 'unknown';
    if (sendsLists || resend) outcome = 'sent';
    else if (result.kind === 'page') outcome = 'unsupported';
    span.setAttr('contacts.list_order', outcome);
    span.setAttr('contacts.list_order_resent', resend);
  }
  return result;
}

/** Reads the local ranked projection. Returns undefined when this tab has no
 * usable cache for the viewer: no host, a retired or unsupported host, an
 * unbound viewer, a pending context, or an older people policy. */
async function readLocalWindow(
  host: ContactDirectoryHost | undefined,
  {
    viewer,
    request,
    policy,
    policyKey,
    limit,
    signal,
    online,
    span,
  }: WindowInput
): Promise<ContactDirectoryPage | undefined> {
  const people = host?.people;
  if (!host || host.disabled || !people) return undefined;

  const generation = await readContactCacheScope(host, viewer, signal);
  if (!generation) return undefined;

  // A continuation only resumes the storage generation that issued it.
  if (
    request.cursor?.source === 'people' &&
    request.cursor.generation !== generation
  )
    throw new ContactDirectoryScopeError();

  const search = (lists: ListOrder | undefined) =>
    people.search({
      mode: policy.mode,
      excluded: policy.excluded,
      senderDomain: policy.senderDomain,
      ...lists,
      scope: { identity: viewer, storageGeneration: generation },
      query: request.query,
      limit,
      nowMs: Date.now(),
      cursor: request.cursor?.after,
    });
  let result: Awaited<ReturnType<typeof people.search>>;
  try {
    result = await span.span('contacts.read_cached_window', () =>
      searchWithListOrder(people, policy, search, span)
    );
  } catch (error) {
    if (
      isStaleHydrationScopeError(error) ||
      (error instanceof Error &&
        error.message === 'contact search cursor changed')
    )
      throw new ContactDirectoryScopeError();
    throw error;
  }
  signal.throwIfAborted();
  await assertContactCacheScope(host, viewer, generation, signal);

  // Native hosts (desktop, iOS, Android) keep an older policy until their next
  // app release; its windows differ only in order, so they stay local.
  if (
    result.kind !== 'page' ||
    result.policyVersion < PEOPLE_MIN_POLICY_VERSION ||
    result.policyVersion > PEOPLE_POLICY_VERSION
  ) {
    // A local continuation cannot move to the server's ID-ordered pages.
    if (request.cursor) throw new ContactDirectoryScopeError();
    return undefined;
  }
  if (result.people.length > limit)
    throw new Error('Contact response exceeds its window');

  const sync = localSync(viewer, generation, result.people.length);
  return {
    users: result.people.map((person) => ({
      id: person.userId,
      name: person.name,
      email: person.email,
      lastInteraction:
        person.lastInteractionMs == null
          ? undefined
          : new Date(person.lastInteractionMs),
    })),
    people: result.people,
    query: request.query,
    source: 'cache',
    sync,
    offline: !online,
    nextCursor: result.nextCursor
      ? {
          source: 'people',
          userId: viewer,
          query: request.query,
          generation,
          after: result.nextCursor,
          policyKey,
        }
      : null,
  };
}

/** A server page that remembers, on itself and on its continuation, that it
 * stands in for a late cache: every page of such a window keeps its place. */
async function readLateAwareServerWindow(
  input: WindowInput,
  cacheLate: boolean
): Promise<ContactDirectoryPage> {
  const page = await readServerWindow(input);
  const cursor = input.request.cursor;
  const localLate =
    cacheLate || (cursor?.source === 'server' && cursor.localLate === true);
  if (!localLate) return page;
  return {
    ...page,
    localLate,
    nextCursor:
      page.nextCursor?.source === 'server'
        ? { ...page.nextCursor, localLate }
        : page.nextCursor,
  };
}

/** The most people one lookup by ID reads: the server's bound for a request. */
const MAX_NAMED_LOOKUP = 500;

/** How long a first server page waits, once its own rows have landed, for the
 * reads of who its text names. */
const NAMED_READ_BUDGET_MS = 2_000;

/** What one extra read came to: its answer, a failure, or nothing in time. */
type ExtraRead<Answer> =
  | { state: 'answered'; answer: Answer | undefined }
  | { state: 'failed' }
  | { state: 'late' };

/** Settles with the read, or as late once `deadline` passes. */
async function extraRead<Answer>(
  read: Promise<Answer> | undefined,
  deadline: Promise<'late'>
): Promise<ExtraRead<Answer>> {
  if (!read) return { state: 'answered', answer: undefined };
  const settle = async (): Promise<ExtraRead<Answer>> => {
    try {
      return { state: 'answered', answer: await read };
    } catch {
      return { state: 'failed' };
    }
  };
  const first = await Promise.race([settle(), deadline]);
  return first === 'late' ? { state: 'late' } : first;
}

/** The rows one extra read answered with, or none when it failed, was late or
 * answered past its bound. */
function answeredRows<Answer>(
  read: ExtraRead<Answer>,
  rows: (answer: Answer) => readonly ContactDirectoryFieldsFragment[],
  bound: number
): readonly ContactDirectoryFieldsFragment[] | undefined {
  if (read.state !== 'answered') return undefined;
  const found = read.answer ? rows(read.answer) : [];
  return found.length > bound ? undefined : found;
}

/** The people the server finds by the typed text's names. With
 * `enable-named-contact-search` it reads the whole directory, ranked by list
 * group and then exact names, and the local ranking's rules classify each
 * person. Without it, it reads the exact name matches of a scan of the first
 * 2,000 contacts, listed as exact. */
async function readServerNames({
  request,
  limit,
  signal,
  span,
}: WindowInput): Promise<{
  viewer: string;
  rows: readonly ContactDirectoryFieldsFragment[];
  exact: boolean;
}> {
  const wholeDirectory = isFeatureEnabled(enableNamedContactSearch);
  span.setAttr(
    'contacts.named_read',
    wholeDirectory ? 'whole_directory' : 'exact_scan'
  );
  if (wholeDirectory) {
    const answer = await span.span('contacts.read_server_named_by', () =>
      fetchContactNamedPeople({ search: request.query, limit }, signal)
    );
    return {
      viewer: answer.user.id,
      rows: answer.user.contactsNamedBy,
      exact: false,
    };
  }
  const answer = await span.span('contacts.read_server_exact', () =>
    fetchContactReferencePage(
      { limit, search: request.query, matching: 'ANY_NAME' },
      signal
    )
  );
  return {
    viewer: answer.user.id,
    rows: answer.user.contacts.nodes,
    exact: true,
  };
}

/** Reads the people typed text may name, for the first server page: the
 * server's people named by the text (`readServerNames`), and by ID a whole
 * typed address or the viewer's teammates (the first 500); a lookup by ID
 * finds a person however large the directory is. Each read only adds people
 * to rank, so one that fails, or has not answered when the page's own rows
 * are in and the budget is spent, costs the page those people and nothing
 * else: the other read's people and the page's own rows are still ranked. */
async function readNamedPeople(
  typed: TypedText,
  input: WindowInput,
  page: Promise<unknown>
): Promise<{
  exact: readonly ContactDirectoryFieldsFragment[];
  named: readonly ContactDirectoryFieldsFragment[];
  lookedUp: readonly ContactDirectoryFieldsFragment[];
}> {
  const { viewer, request, limit, signal, span } = input;
  if (!typed.text) return { exact: [], named: [], lookedUp: [] };

  // A whole address names one person; any other text may name a teammate.
  const lookupIds = new Set<string>();
  for (const id of typed.identity
    ? [typed.identity]
    : (request.teammates ?? [])) {
    const supported = canonicalContactUserId(id);
    if (supported && lookupIds.size < MAX_NAMED_LOOKUP)
      lookupIds.add(supported);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, NAMED_READ_BUDGET_MS);
  });
  const deadline = (async (): Promise<'late'> => {
    await Promise.allSettled([page, budget]);
    return 'late';
  })();
  const [names, lookedUp] = await Promise.all([
    extraRead(
      // No name is an address: a whole one is looked up by ID, and nothing
      // names part of one.
      typed.text.includes('@') ? undefined : readServerNames(input),
      deadline
    ),
    extraRead(
      lookupIds.size
        ? span.span('contacts.read_server_named', () =>
            fetchContactDirectoryByIds([...lookupIds], signal)
          )
        : undefined,
      deadline
    ),
  ]);
  clearTimeout(timer);
  // A superseded read ends here, whatever its reads answered.
  signal.throwIfAborted();
  const answeredViewers = [
    names.state === 'answered' ? names.answer?.viewer : undefined,
    lookedUp.state === 'answered' ? lookedUp.answer?.user.id : undefined,
  ];
  if (answeredViewers.some((id) => id !== undefined && id !== viewer))
    throw new ContactDirectoryScopeError();

  const found = {
    names: answeredRows(names, (answer) => answer.rows, limit),
    lookedUp: answeredRows(
      lookedUp,
      (answer) => answer.user.contactsByUserIds,
      lookupIds.size
    ),
  };
  if ([names, lookedUp].some((read) => read.state === 'late'))
    span.setAttr('contacts.named_late', true);
  if (!found.names || !found.lookedUp)
    span.setAttr('contacts.named_failed', true);
  const exact = names.state === 'answered' && names.answer?.exact === true;
  return {
    exact: exact ? (found.names ?? []) : [],
    named: exact ? [] : (found.names ?? []),
    lookedUp: found.lookedUp ?? [],
  };
}

/** Lists the people the text names ahead of the rest of the server's page,
 * each person once: the server's exact matches, then everyone read whom the
 * text names exactly, then those it names by a word start, then the page.
 * `named` people come in the server's rank order, ahead of the other reads. */
function listNamedFirst(
  typed: TypedText,
  people: { exact: IUser[]; named: IUser[]; lookedUp: IUser[]; page: IUser[] }
): { users: IUser[]; named: NonNullable<ContactDirectoryPage['named']> } {
  const listed = new Map<string, IUser>();
  const add = (users: IUser[]) => {
    const added: string[] = [];
    for (const user of users) {
      if (listed.has(user.id)) continue;
      listed.set(user.id, user);
      added.push(user.id);
    }
    return added;
  };
  const read = [...people.named, ...people.lookedUp, ...people.page];
  const named = {
    exact: add([
      ...people.exact,
      ...read.filter((user) => namedBy(typed, user) === 'exact'),
    ]),
    wordStart: add(read.filter((user) => namedBy(typed, user))),
  };
  add(people.page);
  return { users: [...listed.values()], named };
}

/** Without a usable local cache, reads one bounded server page. The server
 * filters by name/email subsequence in contact-ID order, without the local
 * ranking, so a person typed by name can be far down the page or past it. The
 * first page of a typed search therefore also reads the people the text names
 * and lists them first. Explicit exclusions are applied here. A page may be
 * empty and still continue. */
async function readServerWindow(
  input: WindowInput
): Promise<ContactDirectoryPage> {
  const { viewer, request, policy, policyKey, limit, signal, online, span } =
    input;
  // A server continuation cannot resume a local page.
  if (request.cursor && request.cursor.source !== 'server')
    throw new ContactDirectoryScopeError();

  const typed = typedText(request.cursor ? '' : request.query);
  const pageRead = span.span('contacts.read_server_window', () =>
    fetchContactDirectoryPage(
      {
        limit,
        after: request.cursor?.after ?? null,
        search: request.query || null,
      },
      signal
    )
  );
  const [result, namedPeople] = await Promise.all([
    pageRead,
    readNamedPeople(typed, input, pageRead),
  ]);
  if (result.user.id !== viewer) throw new ContactDirectoryScopeError();

  const page = result.user.contacts;
  if (page.nodes.length > limit)
    throw new Error('Contact response exceeds its window');

  const excluded = new Set(policy.excluded.map((id) => id.toLowerCase()));
  const eligible = (contacts: readonly ContactDirectoryFieldsFragment[]) =>
    contacts
      .map(contactToUser)
      .filter((user) => !excluded.has(user.id.toLowerCase()));
  const { users, named } = listNamedFirst(typed, {
    exact: eligible(namedPeople.exact),
    named: eligible(namedPeople.named),
    lookedUp: eligible(namedPeople.lookedUp),
    page: eligible(page.nodes),
  });

  if (typed.text) {
    span.setAttr('contacts.named_exact_count', named.exact.length);
    span.setAttr('contacts.named_word_start_count', named.wordStart.length);
  }
  return {
    users,
    ...(typed.text ? { named } : {}),
    query: request.query,
    source: 'server',
    sync: 'unavailable',
    offline: !online,
    nextCursor: page.nextCursor
      ? {
          source: 'server',
          userId: viewer,
          query: request.query,
          after: page.nextCursor,
          policyKey,
        }
      : null,
  };
}
