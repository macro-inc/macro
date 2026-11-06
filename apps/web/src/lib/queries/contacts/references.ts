import { emailToMacroId, tryMacroId } from '@core/user/macroId';
import { normalizeNameText } from '@core/util/name-match-score';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  MAX_PEOPLE_BATCH,
  MAX_PEOPLE_QUERY_BYTES,
  MAX_REFERENCE_WITNESSES,
  PEOPLE_REFERENCE_POLICY_VERSION,
  type PeopleReferenceRequest,
  PeopleReferenceRequestSchema,
  type PeopleReferenceResult,
} from '@graphql-cache/people/generated';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import type { GraphqlContactMatching } from '@service-storage/graphql/generated/graphql';
import { fetchContactReferencePage } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { validate as validEmail } from 'email-validator';
import { match } from 'ts-pattern';
import { loadContactCheckpoint } from './backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from './cache-scope';
import { contactRecordKey } from './contact-key';
import {
  canonicalContactUserId,
  MAX_CONTACT_ID_BYTES,
} from './contact-user-id';
import { type ContactLookupHost, resolveContactDirectory } from './lookup';

export type ContactReferenceMatch = Extract<
  PeopleReferenceResult,
  { kind: 'resolved' }
>['matches'][number];
export type ContactReferencePerson = ContactReferenceMatch['people'][number];
export type ContactReferenceRequest = Pick<
  PeopleReferenceRequest,
  'labels' | 'matching' | 'excludeSecondaryInboxes'
> & {
  /** Owned inbox facts for HTTP fallback; undefined is not a known empty set. */
  secondaryInboxIds?: readonly string[];
};
export type ContactReferenceHost = ContactLookupHost &
  Pick<CacheHost, 'people'>;
export type ContactReferenceResolution = {
  matches: ContactReferenceMatch[];
  source: 'cache' | 'server' | 'mixed' | 'empty' | 'unavailable';
  offline: boolean;
  /** Readiness sampled before the native scan; completion afterward cannot
   * retroactively turn a partial scan into proof of uniqueness. */
  native?: {
    generation: string;
    completedAt: number | null;
    contextPending: boolean;
    supported: boolean;
  };
};
type ReferenceReads = {
  page: typeof fetchContactReferencePage;
  lookup: typeof resolveContactDirectory;
};
const READS: ReferenceReads = {
  page: fetchContactReferencePage,
  lookup: resolveContactDirectory,
};
const UTF8 = new TextEncoder();

export function assertContactReferenceInput(
  request: ContactReferenceRequest
): void {
  if (
    !Array.isArray(request.labels) ||
    request.labels.length > MAX_PEOPLE_BATCH ||
    request.labels.some(
      (label) =>
        typeof label !== 'string' ||
        label.length > MAX_CONTACT_ID_BYTES ||
        !label.trim() ||
        UTF8.encode(label).length > MAX_CONTACT_ID_BYTES ||
        (UTF8.encode(label).length > MAX_PEOPLE_QUERY_BYTES &&
          !contactReferenceIdentity(label))
    ) ||
    !PeopleReferenceRequestSchema.shape.matching.safeParse(request.matching)
      .success ||
    typeof request.excludeSecondaryInboxes !== 'boolean'
  )
    throw new Error('Invalid contact reference request');
}

/** Addresses and ids are explicit identities, not another person's display-name alias. */
export function contactReferenceIdentity(label: string): string | undefined {
  if (label.length > MAX_CONTACT_ID_BYTES) return;
  const value = label.trim().toLowerCase();
  const id = tryMacroId(value);
  if (id && !id.includes('$') && UTF8.encode(id).length <= MAX_CONTACT_ID_BYTES)
    return id;
  return validEmail(value)
    ? canonicalContactUserId(`macro|${value}`)
    : undefined;
}

function matchesStage(
  person: ContactReferencePerson,
  label: string,
  stage: GraphqlContactMatching
) {
  const full = normalizeNameText(person.name ?? person.email);
  const exact =
    full === label ||
    person.email.toLowerCase() === label ||
    person.userId.toLowerCase() === label;
  const first = full.split(' ')[0] === label;
  return match(stage)
    .with('EXACT', () => exact)
    .with('FIRST_NAME', () => first)
    .with('ANY_NAME', () => exact || first)
    .exhaustive(() => {
      throw new Error('Invalid contact reference matching');
    });
}

async function serverReference(
  viewer: string,
  label: string,
  matching: ContactReferenceRequest['matching'],
  excluded: ReadonlySet<string>,
  signal: AbortSignal,
  fetchPage: typeof fetchContactReferencePage,
  countPage: () => void
): Promise<ContactReferenceMatch> {
  const stages = match(matching)
    .returnType<GraphqlContactMatching[]>()
    .with('preferFullName', () => ['EXACT', 'FIRST_NAME'])
    .with('anyName', () => ['ANY_NAME'])
    .with('exact', () => ['EXACT'])
    .exhaustive(() => {
      throw new Error('Invalid contact reference matching');
    });
  for (const stage of stages) {
    const people: ContactReferencePerson[] = [];
    let after: string | null = null;
    for (;;) {
      signal.throwIfAborted();
      const page = await fetchPage(
        { limit: MAX_PEOPLE_BATCH, after, search: label, matching: stage },
        signal
      );
      signal.throwIfAborted();
      countPage();
      if (page.user.id !== viewer) throw new ContactDirectoryScopeError();
      if (page.user.contacts.nodes.length > MAX_PEOPLE_BATCH)
        throw new Error('Contact reference page exceeds its bound');
      for (const record of page.user.contacts.nodes) {
        const id = tryMacroId(record.userId.toLowerCase());
        if (
          !id ||
          UTF8.encode(id).length > MAX_CONTACT_ID_BYTES ||
          emailToMacroId(record.email.toLowerCase()) !== id ||
          contactRecordKey(viewer, id) !== `GraphqlContact:${record.id}`
        )
          throw new ContactDirectoryScopeError();
        const person = { userId: id, email: record.email, name: record.name };
        if (!matchesStage(person, label, stage))
          throw new Error('Contact reference predicate mismatch');
        if (excluded.has(id) || people.some((item) => item.userId === id))
          continue;
        people.push(person);
        if (people.length === MAX_REFERENCE_WITNESSES)
          return { complete: true, people };
      }
      const next = page.user.contacts.nextCursor;
      if (next === null) break;
      if (
        typeof next !== 'string' ||
        !next ||
        next === after ||
        UTF8.encode(next).length > 4096
      )
        throw new Error('Contact reference search did not advance');
      after = next;
    }
    // A unique whole-name match wins only after the exact pass has exhausted.
    if (people.length) return { complete: true, people };
  }
  return { complete: true, people: [] };
}

/** Resolve only requested labels. Native scans retain two witnesses; HTTP
 * fallback follows bounded exact pages and never calls the full-list endpoint. */
export async function resolveContactReferences(
  viewer: string,
  host: ContactReferenceHost | undefined,
  request: ContactReferenceRequest,
  signal: AbortSignal,
  reads: ReferenceReads = READS,
  online = typeof navigator === 'undefined' || navigator.onLine
): Promise<ContactReferenceResolution> {
  return Telemetry.span('contacts.resolve_references', async (span) => {
    signal.throwIfAborted();
    assertContactReferenceInput(request);
    if (!request.labels.length)
      return { matches: [], source: 'empty', offline: !online };
    if (!viewer) throw new Error('Contact references require authentication');
    const matches: ContactReferenceMatch[] = request.labels.map(() => ({
      complete: false,
      people: [],
    }));
    const sources = new Set<'cache' | 'server'>();
    let offline = !online;
    let generation: string | undefined;
    let nativeState: ContactReferenceResolution['native'];
    let pages = 0;
    const excluded = new Set<string>(
      (request.excludeSecondaryInboxes
        ? (request.secondaryInboxIds ?? [])
        : []
      ).flatMap((id) => {
        const canonical = canonicalContactUserId(id);
        return canonical ? [canonical] : [];
      })
    );
    const exclusionsReady =
      !request.excludeSecondaryInboxes ||
      request.secondaryInboxIds !== undefined;
    const identities = request.labels.map(contactReferenceIdentity);
    const literals = request.labels.map(
      (label) =>
        label.trim().toLowerCase().startsWith('macro|') ||
        validEmail(label.trim())
    );
    const nameIndexes = identities.flatMap((id, index) =>
      id || literals[index] ? [] : [index]
    );
    literals.forEach((literal, index) => {
      if (literal && !identities[index])
        matches[index] = { complete: true, people: [] };
    });
    span.setAttr('contacts.reference_count', request.labels.length);
    span.setAttr('contacts.reference_matching', request.matching);
    try {
      if (host && !host.disabled)
        generation = await readContactCacheScope(host, viewer, signal);
      if (nameIndexes.length && host && !host.disabled && host.people) {
        if (generation) {
          const completedAt = loadContactCheckpoint(
            viewer,
            generation
          ).completedAt;
          const native = await host.people.resolveReferences({
            scope: { identity: viewer, storageGeneration: generation },
            labels: nameIndexes.map((index) => request.labels[index]),
            matching: request.matching,
            excludeSecondaryInboxes: request.excludeSecondaryInboxes,
          });
          await assertContactCacheScope(host, viewer, generation, signal);
          nativeState = {
            generation,
            completedAt,
            contextPending: native.kind === 'contextPending',
            supported: native.kind !== 'unsupported',
          };
          if (
            native.kind === 'resolved' &&
            native.policyVersion >= PEOPLE_REFERENCE_POLICY_VERSION
          ) {
            if (
              native.matches.length !== nameIndexes.length ||
              native.matches.some(
                (entry) => entry.people.length > MAX_REFERENCE_WITNESSES
              )
            )
              throw new Error('Invalid contact reference response');
            const complete = completedAt !== null;
            native.matches.forEach((entry, index) => {
              matches[nameIndexes[index]] = {
                people: entry.people,
                complete: complete && entry.complete,
              };
            });
            sources.add('cache');
          } else if (native.kind === 'resolved') nativeState.supported = false;
        }
      }
      if (exclusionsReady) {
        const ids = identities.flatMap((id) =>
          id && !excluded.has(id) ? [id] : []
        );
        if (ids.length && (online || (host && !host.disabled))) {
          const resolved = await reads.lookup(
            viewer,
            host,
            { kind: 'ids', values: ids },
            signal,
            undefined,
            online
          );
          signal.throwIfAborted();
          if (resolved.source !== 'empty') sources.add(resolved.source);
          offline ||= resolved.offline;
          const byId = new Map(resolved.users.map((user) => [user.id, user]));
          identities.forEach((id, index) => {
            if (!id) return;
            const user = byId.get(id);
            matches[index] = {
              complete: !!user || !resolved.offline,
              people: user
                ? [
                    {
                      userId: user.id,
                      email: user.email,
                      name: user.name ?? null,
                    },
                  ]
                : [],
            };
          });
        }
        identities.forEach((id, index) => {
          if (id && excluded.has(id))
            matches[index] = { complete: true, people: [] };
        });
      }
      if (online && exclusionsReady) {
        const resolvedNames = new Map<string, ContactReferenceMatch>();
        for (const index of nameIndexes) {
          if (matches[index].complete && matches[index].people.length > 0)
            continue;
          const label = normalizeNameText(request.labels[index]);
          let matched = resolvedNames.get(label);
          if (!matched) {
            matched = await serverReference(
              viewer,
              label,
              request.matching,
              excluded,
              signal,
              reads.page,
              () => {
                pages++;
              }
            );
            resolvedNames.set(label, matched);
          }
          matches[index] = matched;
          sources.add('server');
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (isStaleHydrationScopeError(error))
        throw new ContactDirectoryScopeError();
      // Offline evidence remains explicitly incomplete. Authorization and cache
      // failures are never converted into successful absence or an unscoped read.
      if (
        !(error instanceof CombinedError) ||
        !error.networkError ||
        error.response
      )
        throw error;
      offline = true;
    }
    signal.throwIfAborted();
    if (host && generation)
      await assertContactCacheScope(host, viewer, generation, signal);
    const source =
      sources.size > 1
        ? 'mixed'
        : sources.has('server')
          ? 'server'
          : sources.has('cache')
            ? 'cache'
            : matches.every((entry) => entry.complete)
              ? 'empty'
              : 'unavailable';
    span.setAttr('contacts.source', source);
    span.setAttr('contacts.offline', offline);
    span.setAttr('contacts.server_pages', pages);
    span.setAttr(
      'contacts.incomplete_count',
      matches.filter((entry) => !entry.complete).length
    );
    return {
      matches,
      source,
      offline,
      ...(nativeState ? { native: nativeState } : {}),
    };
  });
}
