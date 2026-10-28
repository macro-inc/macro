import { isTransientRequestError } from '@core/util/request-error';
import type { CombinedError } from '@urql/core';

/** Retry transport failures; application errors always release the queue head. */
export function shouldRetryGraphqlMutation(error: CombinedError): boolean {
  if (error.graphQLErrors.length > 0) {
    return false;
  }
  return isTransientRequestError(error);
}
