import { isErr, type MaybeError, type MaybeResult } from './maybeResult';

export function isPaymentError<T>(
  result: MaybeResult<string, T> | MaybeError<string>
): boolean {
  if (!isErr(result)) {
    return false;
  }

  if (isErr(result, 'HTTP_ERROR')) {
    const errorMessage = result[0][0].message;
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
