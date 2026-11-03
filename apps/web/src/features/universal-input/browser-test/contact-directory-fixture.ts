import type { IUser } from '@core/user/types';
import { matchesTokenSubsequences } from '@core/util/string';
import { contactRecordKey } from '@queries/contacts/contact-key';
import type { ContactDirectoryPageQueryVariables } from '@service-storage/graphql/generated/graphql';

const VIEWER = 'macro|viewer@example.com';
let people: readonly IUser[] = [];
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
export async function hydrateGraphqlContacts() {
  throw new Error('No backfill in this fixture');
}
