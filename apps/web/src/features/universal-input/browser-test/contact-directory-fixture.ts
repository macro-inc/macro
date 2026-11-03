import type { IUser } from '@core/user/types';
import { normalizeNameText } from '@core/util/name-match-score';
import { matchesTokenSubsequences } from '@core/util/string';
import { contactRecordKey } from '@queries/contacts/contact-key';
import type {
  ContactDirectoryPageQueryVariables,
  ContactReferencePageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';

const VIEWER = 'macro|viewer@example.com';
let people: readonly IUser[] = [];
export const [referencePages, setReferencePages] = createSignal(0);
export function registerContactFixture(rows: readonly IUser[]) {
  people = rows;
}
export const useQueryAccount = () => () => ({ userId: VIEWER, session: 0 });
export const getGraphqlSoupCacheHost = () => undefined;
const contact = (user: IUser) => ({
  id: contactRecordKey(VIEWER, user.id).slice('GraphqlContact:'.length),
  userId: user.id,
  name: user.name,
  email: user.email,
});
export async function fetchContactDirectoryPage(
  args: ContactDirectoryPageQueryVariables,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const matched = people.filter((user) =>
    matchesTokenSubsequences(`${user.name} | ${user.email}`, args.search ?? '')
  );
  const offset = Number(args.after ?? 0);
  const end = offset + (args.limit ?? 50);
  return {
    user: {
      id: VIEWER,
      contacts: {
        nodes: matched.slice(offset, end).map(contact),
        nextCursor: end < matched.length ? String(end) : null,
      },
    },
  };
}
export async function fetchContactDirectoryByIds(
  ids: string[],
  signal: AbortSignal
) {
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
