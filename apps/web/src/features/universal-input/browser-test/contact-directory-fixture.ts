import type { IUser } from '@core/user/types';
import { normalizeNameText } from '@core/util/name-match-score';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { PEOPLE_POLICY_VERSION } from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { contactRecordKey } from '@queries/contacts/contact-key';
import type { ContactReferencePageQueryVariables } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';

const VIEWER = 'macro|viewer@example.com';
let people: readonly IUser[] = [];
export const [referencePages, setReferencePages] = createSignal(0);
let lookupGate: PromiseWithResolvers<void> | undefined;
export function pauseIdentityLookups() {
  lookupGate ??= Promise.withResolvers<void>();
}
export function resumeIdentityLookups() {
  lookupGate?.resolve();
  lookupGate = undefined;
}
export function registerContactFixture(rows: readonly IUser[]) {
  people = rows;
}
export const useQueryAccount = () => () => ({ userId: VIEWER, session: 0 });
export const getGraphqlSoupCacheHost = () => host;
const contact = (user: IUser) => ({
  id: contactRecordKey(VIEWER, user.id).slice('GraphqlContact:'.length),
  userId: user.id,
  name: user.name,
  email: user.email,
});
const host: CacheHost = {
  ...createNoopCacheHost(),
  disabled: false,
  currentStorageGeneration: async () => '00000000-0000-4000-8000-000000000001',
  readQuery: async () => ({ kind: 'hit', data: { user: { id: VIEWER } } }),
  people: {
    ...unsupportedContactSync,
    context: async () => ({ kind: 'unsupported' }),
    update: async () => {
      throw new Error('Fixture has no publisher');
    },
    readSql: async () => ({ kind: 'unsupported' }),
    resolveReferences: async () => ({ kind: 'unsupported' }),
    search: async (request) => {
      const query = normalizeNameText(request.query);
      const words = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const matched = people.filter((user) => {
        if (request.excluded.includes(user.id)) return false;
        if (query.includes('@'))
          return user.id === query || user.email.toLowerCase() === query;
        const name = normalizeNameText(user.name);
        const nameWords = name.split(/[^\p{L}\p{N}]+/u);
        return (
          !query ||
          (words.length > 0 &&
            words.every((word) =>
              nameWords.some((name) => name.startsWith(word))
            )) ||
          query.split(' ').every((term) => name.includes(term))
        );
      });
      const offset = Number(request.cursor ?? 0),
        end = offset + request.limit;
      return {
        kind: 'page',
        policyVersion: PEOPLE_POLICY_VERSION,
        truncated: end < matched.length,
        nextCursor: end < matched.length ? String(end) : null,
        people: matched.slice(offset, end).map((user) => ({
          recordKey: contactRecordKey(VIEWER, user.id),
          userId: user.id,
          email: user.email,
          name: user.name,
          matchRank: 0,
          score: 0,
          timestampMs: 0,
        })),
      };
    },
  },
};
export async function fetchContactDirectoryByIds(
  ids: string[],
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (lookupGate) await lookupGate.promise;
  signal.throwIfAborted();
  return {
    user: {
      id: VIEWER,
      contactsByUserIds: people
        .filter((user) => ids.includes(user.id))
        .map(contact),
    },
  };
}
export async function fetchContactReferencePage(
  args: ContactReferencePageQueryVariables,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (!navigator.onLine) throw new TypeError('Failed to fetch');
  setReferencePages((count) => count + 1);
  const query = normalizeNameText(args.search);
  const matched = people.filter((user) => {
    const whole = [user.id, user.email, user.name].some(
      (label) => normalizeNameText(label) === query
    );
    const first = normalizeNameText(user.name).split(' ')[0] === query;
    if (args.matching === 'EXACT') return whole;
    if (args.matching === 'FIRST_NAME') return first;
    return whole || first;
  });
  // A bounded server scan may return no matches before its continuation.
  return {
    user: {
      id: VIEWER,
      contacts: {
        nodes: args.after ? matched.slice(0, args.limit ?? 2).map(contact) : [],
        nextCursor: args.after ? null : 'continued-scan',
      },
    },
  };
}
export async function hydrateGraphqlContacts() {
  throw new Error('No backfill in this fixture');
}
