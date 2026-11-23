import type { ResultError } from '@core/util/result';

export const NO_RUNTIME_ACCESS_ERROR = 'NO_RUNTIME_ACCESS' as const;

/** A prompt the agent may not run on its registered runtime, and why. */
export type NoRuntimeAccessError = ResultError<typeof NO_RUNTIME_ACCESS_ERROR>;

export function isNoRuntimeAccessError(
  error: ResultError<string>
): error is NoRuntimeAccessError {
  return error.code === NO_RUNTIME_ACCESS_ERROR;
}

/**
 * The harness's 403 for a stopped agent carries `code: no_runtime_access` and
 * the reason to show; any other 403 is an ordinary refusal.
 */
export async function readNoRuntimeAccessError(
  response: Response
): Promise<NoRuntimeAccessError | undefined> {
  if (response.status !== 403) return;
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'no_runtime_access' &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return { code: NO_RUNTIME_ACCESS_ERROR, message: body.error };
    }
  } catch {
    // A plain-text refusal is not a stopped agent.
  }
}
