import type { Result } from 'neverthrow';
import type { ResultError } from './result';

export function isPaymentError<T>(
  result: Result<T, ResultError<string>[]> | Result<void, ResultError<string>[]>
): boolean {
  if (!result.isErr()) {
    return false;
  }

  // A 403 (entitlement) or 402 (payment required) means the user isn't allowed
  // to do this on their plan — always surface the paywall. 403s come through as
  // a `FORBIDDEN` code; older paths may still report them as `HTTP_ERROR` with
  // the status/reason in the message, so check both.
  return result.error.some((error) => {
    if (error.code === 'FORBIDDEN') {
      return true;
    }
    if (error.code === 'HTTP_ERROR') {
      return (
        error.message.includes('402') ||
        error.message.includes('payment_required') ||
        error.message.includes('403')
      );
    }
    return false;
  });
}
