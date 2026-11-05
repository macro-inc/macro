import type { ResultError } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { PlanTier, RoutineLimitCode } from './generated/schemas';

export const ROUTINE_LIMIT_ERROR = 'ROUTINE_LIMIT' as const;

/** A write refused because the owner's plan allows no more active routines. */
export type RoutineLimitError = ResultError<typeof ROUTINE_LIMIT_ERROR> & {
  plan: PlanTier;
};

function isPlanTier(value: unknown): value is PlanTier {
  return Object.values(PlanTier).some((tier) => tier === value);
}

export function isRoutineLimitError(
  error: unknown
): error is RoutineLimitError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === ROUTINE_LIMIT_ERROR &&
    'plan' in error &&
    isPlanTier(error.plan) &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Only the scheduler's routine-limit refusal; other 402s are unrelated. */
async function readRoutineLimitError(
  response: Response
): Promise<RoutineLimitError | undefined> {
  if (response.status !== 402) return;
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === RoutineLimitCode.routine_limit_reached &&
      'plan' in body &&
      isPlanTier(body.plan) &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return {
        code: ROUTINE_LIMIT_ERROR,
        plan: body.plan,
        message: body.error,
      };
    }
  } catch {
    // A malformed or non-JSON payment response is not a routine-limit refusal.
  }
}

/** Used by writes that can make a routine active; it has no presentation effects. */
export async function routineLimitErrorResponseHandler(response: Response) {
  return (
    (await readRoutineLimitError(response)) ?? statusError(response.status)
  );
}
