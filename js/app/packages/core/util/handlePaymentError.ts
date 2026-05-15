import type { AppErrorResult, AppResult } from './result';

export function isPaymentError<T>(
  result: AppResult<string, T> | AppErrorResult<string>
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
