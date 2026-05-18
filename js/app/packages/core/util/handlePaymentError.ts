import type { Result } from 'neverthrow';
import type { ResultError } from './result';

export function isPaymentError<T>(
  result: Result<T, ResultError<string>[]> | Result<void, ResultError<string>[]>
): boolean {
  if (!result.isErr()) {
    return false;
  }

  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'HTTP_ERROR')
  ) {
    const errorMessage = result.error[0].message;
    if (
      errorMessage.includes('402') ||
      errorMessage.includes('payment_required') ||
      errorMessage.includes('403')
    ) {
      return true;
    }
  }

  return false;
}
