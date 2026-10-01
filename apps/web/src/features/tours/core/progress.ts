/** The per-user key-value namespace that holds tour progress, keyed by tour id. */
export const TOURS_NAMESPACE = 'tours';

/**
 * A user's progress through one tour: finished or dismissed tours stay
 * hidden, and an unfinished tour resumes at the step last reached.
 */
export type TourProgress =
  | { status: 'completed' | 'dismissed' }
  | { status: 'active'; step: number };

/** Reads stored progress, treating anything unrecognized as no progress. */
export function parseTourProgress(value: unknown): TourProgress | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { status, step } = value as { status?: unknown; step?: unknown };
  if (status === 'completed' || status === 'dismissed') return { status };
  if (status === 'active' && typeof step === 'number' && step >= 0)
    return { status: 'active', step };
  return undefined;
}

/** Progress saved by earlier builds in localStorage, as a JSON string. */
export function parseLegacyTourProgress(
  raw: string | null
): TourProgress | undefined {
  if (!raw) return undefined;
  try {
    return parseTourProgress(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
