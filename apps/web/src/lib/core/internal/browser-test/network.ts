import { contactRecordKey } from '@queries/contacts/contact-key';
import { createSignal } from 'solid-js';
import { fetchTeamContactPage } from './onboarding-contact-network';

export const [lookupIds, setLookupIds] = createSignal<readonly string[]>([]);
export const [lookupSizes, setLookupSizes] = createSignal<number[]>([]);

import {
  fetchImportIds,
  fetchImportReferences,
} from './import-contact-network';
import { fetchContactReferencePage as fetchTaskReferences } from './task-filter-people';
export const fetchContactReferencePage: typeof fetchTaskReferences = (
  input,
  signal
) =>
  new URLSearchParams(location.search).has('linear-import')
    ? fetchImportReferences(input, signal)
    : fetchTaskReferences(input, signal);

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
  if (new URLSearchParams(location.search).has('onboarding-contacts'))
    return fetchTeamContactPage(variables, signal);
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
  if (new URLSearchParams(location.search).has('linear-import'))
    return fetchImportIds(userIds, signal);
  signal.throwIfAborted();
  setLookupIds([...userIds]);
  setLookupSizes((sizes) => [...sizes, userIds.length]);
  return {
    user: {
      id: viewer,
      contactsByUserIds: userIds.flatMap((userId) => {
        let name: string | undefined;
        if (userId === 'macro|selected@example.com') name = 'Selected Person';
        else if (userId === 'macro|viewer@example.com') name = 'Viewer';
        else if (userId === 'macro|match@example.com') name = 'Broader match';
        else if (/^macro\|person\d+@example\.com$/.test(userId))
          name = `Person ${userId.slice(12).split('@')[0]}`;
        if (!name) return [];
        return [
          {
            id: contactRecordKey(viewer, userId).slice(
              'GraphqlContact:'.length
            ),
            userId,
            email: userId.slice(6),
            name,
          },
        ];
      }),
    },
  };
}

export async function hydrateGraphqlContacts(): Promise<never> {
  throw new Error('Background hydration is not mounted by this fixture');
}
