import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { AnyVariables, Client, OperationResult } from '@urql/core';
import { v4 as uuidv4 } from 'uuid';
import {
  MarkEmailThreadSeenDocument,
  UpdateEmailThreadReadLabelDocument,
} from './graphql/generated/graphql';

export type EmailReadStateDisposition = 'committed' | 'queued';

function readStateDisposition<T, V extends AnyVariables>(
  result: OperationResult<T, V>,
  hasReadState: boolean
): EmailReadStateDisposition {
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return 'queued';
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  if (!hasReadState)
    throw new Error('Email read-state mutation returned no data');
  return 'committed';
}

/** The cache exchange owns optimistic commit/rollback, including offline replay. */
export async function markGraphqlEmailThreadSeen(
  client: Client,
  threadId: string
): Promise<EmailReadStateDisposition> {
  const result = await executeOptimisticMutation(
    client,
    MarkEmailThreadSeenDocument,
    { input: { threadId } },
    {
      markEmailThreadSeen: {
        __typename: 'GraphqlSoupEmailThread',
        id: threadId,
        isRead: true,
      },
    },
    // Keep distinct read/unread intents ordered; a newer action must not be
    // rolled back by a previous request's failure.
    { uuid: uuidv4() }
  ).toPromise();
  return readStateDisposition(
    result,
    Boolean(result.data?.markEmailThreadSeen)
  );
}

/** The UNREAD label id is resolved for the thread's inbox by the query layer. */
export async function markGraphqlEmailThreadUnread(
  client: Client,
  threadId: string,
  unreadLabelId: string
): Promise<EmailReadStateDisposition> {
  const result = await executeOptimisticMutation(
    client,
    UpdateEmailThreadReadLabelDocument,
    { input: { threadId, labelId: unreadLabelId, value: true } },
    {
      updateEmailThreadLabel: {
        __typename: 'GraphqlSoupEmailThread',
        id: threadId,
        isRead: false,
      },
    },
    { uuid: uuidv4() }
  ).toPromise();
  return readStateDisposition(
    result,
    Boolean(result.data?.updateEmailThreadLabel)
  );
}
