import type {
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
export async function hydrateGraphqlContacts(): Promise<never> {
  throw new Error('Background hydration is not mounted by this fixture');
}
