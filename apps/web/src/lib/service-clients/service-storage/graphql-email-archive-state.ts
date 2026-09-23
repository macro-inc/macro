import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  type QueryRevalidation,
} from '@graphql-cache/exchange/optimistic';
import type { Client } from '@urql/core';
import { v4 as uuidv4 } from 'uuid';
import { SetEmailThreadArchivedDocument } from './graphql/generated/graphql';

/** Archive, unarchive, and Undo share an ordered durable normalized-cache write. */
export async function setGraphqlEmailThreadArchived(
  client: Client,
  threadId: string,
  archived: boolean,
  revalidations: readonly QueryRevalidation[] = []
): Promise<'committed' | 'queued'> {
  const result = await executeOptimisticMutation(
    client,
    SetEmailThreadArchivedDocument,
    { input: { threadId, archived } },
    {
      setEmailThreadArchived: {
        __typename: 'GraphqlSoupEmailThread',
        id: threadId,
        inboxVisible: !archived,
      },
    },
    { uuid: uuidv4(), revalidations }
  ).toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return 'queued';
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  if (!result.data?.setEmailThreadArchived) {
    throw new Error('Email archive mutation returned no data');
  }
  return 'committed';
}
