import { contactRecordKey } from '@queries/contacts/contact-key';
import type {
  ContactDirectoryByUserIdsQuery,
  ContactDirectoryPageQuery,
  ContactDirectoryPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';

export let viewer = 'account-a';
export function changeViewer(value: string) {
  viewer = value;
}
export async function fetchContactDirectoryPage(
  variables: ContactDirectoryPageQueryVariables,
  signal: AbortSignal
): Promise<ContactDirectoryPageQuery> {
  signal.throwIfAborted();
  return {
    user: {
      id: viewer,
      contacts: variables.after
        ? {
            nodes: [
              {
                id: 'server-scoped-id',
                userId: 'macro|server@example.com',
                email: 'server@example.com',
                name: 'Server match',
              },
            ],
            nextCursor: null,
          }
        : { nodes: [], nextCursor: 'after-budget' },
    },
  };
}
export async function fetchContactDirectoryByIds(
  userIds: string[],
  signal: AbortSignal
): Promise<ContactDirectoryByUserIdsQuery> {
  signal.throwIfAborted();
  return {
    user: {
      id: viewer,
      contactsByUserIds: userIds
        .filter((id) => id === 'macro|selected@example.com')
        .map((userId) => ({
          id: contactRecordKey(viewer, userId).slice('GraphqlContact:'.length),
          userId,
          email: userId.slice(6),
          name: 'Selected Person',
        })),
    },
  };
}

export async function hydrateGraphqlContacts(): Promise<never> {
  throw new Error('Background hydration is not mounted by this fixture');
}
