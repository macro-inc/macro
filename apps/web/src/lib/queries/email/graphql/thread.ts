import { ThrownResultError } from '@core/util/result';
import type { ApiThread } from '@service-email/generated/schemas';
import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import { mapGraphqlEmailThreadPage } from './mapper';

const KNOWN_THREAD_ERROR_CODES = new Set(['NOT_FOUND', 'UNAUTHORIZED', 'GONE']);

function throwGraphqlError(error: CombinedError): never {
  const knownErrors = error.graphQLErrors.flatMap((graphqlError) => {
    const code = graphqlError.extensions?.code;
    return typeof code === 'string' && KNOWN_THREAD_ERROR_CODES.has(code)
      ? [{ code, message: graphqlError.message }]
      : [];
  });

  if (knownErrors.length > 0) {
    throw new ThrownResultError(knownErrors);
  }

  throw error;
}

/** Fetches one email-thread message page through GraphQL. */
export async function fetchGraphqlEmailThreadPage(
  threadId: string,
  offset: number,
  limit: number
): Promise<ApiThread> {
  const result = await getGraphqlSoupClient()
    .query(
      EmailThreadPageDocument,
      { threadId, offset, limit },
      // Keep the GraphQL operation on the app's cache-and-network policy.
      // urql's toPromise resolves with the revalidated, non-stale result.
      { requestPolicy: 'cache-and-network' }
    )
    .toPromise();

  if (result.error) throwGraphqlError(result.error);

  const thread = result.data?.user.emailThread;
  if (!thread) {
    // TODO(email-graphql): Direct lookup currently returns null for both missing
    // and inaccessible threads. Restore distinct MISSING/UNAUTHORIZED/GONE
    // states when the GraphQL API exposes a typed lookup result.
    throw new ThrownResultError([
      { code: 'NOT_FOUND', message: 'Email thread not found' },
    ]);
  }

  return mapGraphqlEmailThreadPage(thread);
}
