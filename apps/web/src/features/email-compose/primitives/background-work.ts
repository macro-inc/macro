import { fireAndForget } from '@core/util/fireAndForget';

/** Awaits `work`, passing a rejection to `report` instead of rethrowing it. */
export async function reportFailure(
  work: Promise<unknown>,
  report: (error: unknown) => void
): Promise<void> {
  try {
    await work;
  } catch (error) {
    report(error);
  }
}

/** Starts `work` without waiting for it, passing a rejection to `report`. */
export function startReported(
  work: Promise<unknown>,
  report: (error: unknown) => void
): void {
  fireAndForget(reportFailure(work, report), 'email-compose');
}

/** Awaits `work` whatever its outcome; the caller has already handled a failure. */
export async function settle(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The caller handles the failure elsewhere or has no use for it.
  }
}
