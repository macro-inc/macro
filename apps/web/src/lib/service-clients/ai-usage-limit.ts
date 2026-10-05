import type { ResultError } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import type { AiDenyCode } from './service-auth/ai-billing-types';

export const AI_USAGE_LIMIT_ERROR = 'AI_USAGE_LIMIT' as const;

export type AiUsageLimitError = ResultError<typeof AI_USAGE_LIMIT_ERROR> & {
  reason: AiDenyCode;
};

const KNOWN_CODES: readonly AiDenyCode[] = [
  'ai_allowance_exhausted',
  'ai_overage_limit_reached',
  'ai_overage_payment_failed',
];

export function isAiDenyCode(code: unknown): code is AiDenyCode {
  return (
    typeof code === 'string' && KNOWN_CODES.some((known) => known === code)
  );
}

export function isAiUsageLimitError(
  error: unknown
): error is AiUsageLimitError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === AI_USAGE_LIMIT_ERROR &&
    'reason' in error &&
    isAiDenyCode(error.reason) &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Only explicit quota refusals are usage limits; other 402s are unrelated. */
export async function readAiUsageLimitError(
  response: Response
): Promise<AiUsageLimitError | undefined> {
  if (response.status !== 402) return;
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      isAiDenyCode(body.code)
    ) {
      return {
        code: AI_USAGE_LIMIT_ERROR,
        reason: body.code,
        message:
          'error' in body && typeof body.error === 'string'
            ? body.error
            : 'AI usage limit reached.',
      };
    }
  } catch {
    // A malformed or non-JSON payment response is not a quota refusal.
  }
}

/** Used only by endpoints that spend AI usage; it has no presentation effects. */
export async function aiUsageErrorResponseHandler(response: Response) {
  return (
    (await readAiUsageLimitError(response)) ?? statusError(response.status)
  );
}
