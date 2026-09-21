import type { CombinedError } from '@urql/core';

/** Keep uncertain writes queued; application errors require explicit server opt-in. */
export function shouldRetryGraphqlMutation(error: CombinedError): boolean {
  return (
    error.networkError != null ||
    (error.graphQLErrors.length > 0 &&
      error.graphQLErrors.every((error) => error.extensions.retryable === true))
  );
}
