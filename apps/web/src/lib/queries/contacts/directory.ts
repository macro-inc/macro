import type { IUser } from '@core/user/types';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  PEOPLE_POLICY_VERSION,
  type PeopleSearch,
  type PeopleSearchResult,
} from '@graphql-cache/people/generated';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import type { ContactDirectoryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { hashKey } from '@tanstack/solid-query';
import { loadContactCheckpoint } from './backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';

export { ContactDirectoryScopeError } from './cache-scope';
export const CONTACT_WINDOW_SIZE = 50;

/** Hydration or context publication can make a later local read available. */
export class ContactDirectoryUnavailableError extends Error {
  constructor() {
    super(
      'Local contact search is unavailable; wait for synchronization or retry'
    );
  }
}

export type ContactDirectoryCursor = {
  source: 'people';
  userId: string;
  query: string;
  generation: string;
  after: string;
  policyKey: string;
};
export type ContactPeoplePolicy = Pick<
  PeopleSearch,
  'mode' | 'excluded' | 'senderDomain'
>;
export type RankedPerson = Extract<
  PeopleSearchResult,
  { kind: 'page' }
>['people'][number];
export type ContactDirectoryRequest = {
  query: string;
  limit?: number;
  cursor?: ContactDirectoryCursor;
  policy?: ContactPeoplePolicy;
};
export type ContactDirectoryPage = {
  users: IUser[];
  people?: RankedPerson[];
  query: string;
  source: 'cache';
  sync: 'cold' | 'partial' | 'snapshot' | 'unavailable';
  offline: boolean;
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

/** Interactive suggestions read only the existing local indexed projection.
 * Incomplete hydration is an explicit partial window, never a remote search. */
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
    if (
      !viewer ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      new TextEncoder().encode(request.query).length > 512 ||
      policy.excluded.length > 500 ||
      policy.excluded.some(
        (id) => new TextEncoder().encode(id).length > 1024
      ) ||
      (policy.senderDomain != null &&
        new TextEncoder().encode(policy.senderDomain).length > 255)
    )
      throw new Error('Invalid contact window');
    const policyKey = hashKey([policy]);
    if (
      request.cursor &&
      (request.cursor.userId !== viewer ||
        request.cursor.query !== request.query ||
        request.cursor.policyKey !== policyKey)
    )
      throw new ContactDirectoryScopeError();
    const people = host?.people;
    if (!host || host.disabled || !people)
      throw new ContactDirectoryUnavailableError();
    const generation = await readContactCacheScope(host, viewer, signal);
    if (!generation) throw new ContactDirectoryUnavailableError();
    if (request.cursor && request.cursor.generation !== generation)
      throw new ContactDirectoryScopeError();
    span.setAttr('contacts.query_length', request.query.length);
    span.setAttr('contacts.limit', limit);
    let result: Awaited<ReturnType<typeof people.search>>;
    try {
      result = await span.span('contacts.read_cached_window', () =>
        people.search({
          ...policy,
          scope: { identity: viewer, storageGeneration: generation },
          query: request.query,
          limit,
          nowMs: Date.now(),
          cursor: request.cursor?.after,
        })
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
    if (
      result.kind !== 'page' ||
      result.policyVersion !== PEOPLE_POLICY_VERSION
    )
      throw new ContactDirectoryUnavailableError();
    if (result.people.length > limit)
      throw new Error('Contact response exceeds its window');
    const checkpoint = loadContactCheckpoint(viewer, generation);
    const sync =
      checkpoint.completedAt !== null
        ? 'snapshot'
        : checkpoint.pages || result.people.length
          ? 'partial'
          : 'cold';
    span.setAttr('contacts.source', 'cache');
    span.setAttr('contacts.sync', sync);
    span.setAttr('contacts.result_count', result.people.length);
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
  });
}
