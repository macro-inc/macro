import type { ErrorResponseHandler } from '@core/util/safeFetch';
import { statusError } from '@core/util/safeFetch';

/** Preserve the quote's actionable billing conflict at the query boundary. */
export const teamAgentQuoteErrorResponseHandler: ErrorResponseHandler<
  'no_subscription'
> = async (response) => {
  if (response.status === 409) {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'no_subscription'
    ) {
      return {
        code: 'no_subscription',
        message: 'The team needs an active plan.',
      };
    }
  }
  return statusError(response.status);
};
