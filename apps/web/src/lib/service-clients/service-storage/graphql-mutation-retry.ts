import { isTransientRequestError } from '@core/util/request-error';
import type { CombinedError } from '@urql/core';

/** Keep uncertain writes queued; application errors require explicit server opt-in. */
export function shouldRetryGraphqlMutation(error: CombinedError): boolean {
  if (error.graphQLErrors.length > 0) {
    return error.graphQLErrors.every(
      (error) => error.extensions.retryable === true
    );
  }
  return isTransientRequestError(error);
}
