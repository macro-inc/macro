import { queryClient } from '../../client';
import { graphqlSoupKeys } from './keys';

/** Ephemeral session fence, not a credential or a persisted cache identity. */
export function getGraphqlSoupDoneSession(): string {
  const current = queryClient.getQueryData<string>(
    graphqlSoupKeys.doneSession.queryKey
  );
  if (current) return current;
  const session = crypto.randomUUID();
  queryClient.setQueryData(graphqlSoupKeys.doneSession.queryKey, session);
  return session;
}

/** Retire old operations before a login/logout refetch can publish new identity. */
export function resetGraphqlSoupDoneSession(): void {
  queryClient.removeQueries({ queryKey: graphqlSoupKeys.pendingDone._def });
  // Rotate after removal so mounted observers rebind to a fresh query even when
  // native authentication signs back into the same account without a reload.
  queryClient.setQueryData(
    graphqlSoupKeys.doneSession.queryKey,
    crypto.randomUUID()
  );
}
