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

/** Show only the server's safe repository failure, which precedes purchase. */
export const teamAgentCreateErrorResponseHandler: ErrorResponseHandler<
  'repository_creation_failed' | 'quote_changed'
> = async (response) => {
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => undefined);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'quote_changed'
    ) {
      return {
        code: 'quote_changed',
        message:
          'The invitation price changed. Review the updated quote before confirming.',
      };
    }
    return statusError(response.status);
  }
  if (response.status === 502) {
    const body: unknown = await response.json().catch(() => undefined);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'repository_creation_failed' &&
      'message' in body &&
      typeof body.message === 'string' &&
      body.message.length > 0
    ) {
      return { code: 'repository_creation_failed', message: body.message };
    }
  }
  return statusError(response.status);
};
