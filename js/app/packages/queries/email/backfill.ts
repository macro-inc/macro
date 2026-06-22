import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { emailKeys } from './keys';

/**
 * How far along a link's backfill is, as last reported by a `backfill_progress`
 * websocket event. `completed`/`total` mirror the backend's `completed_threads`
 * / `total_threads`. Both can read slightly above the real mailbox size — the
 * priority pass inflates them in lockstep — so prefer the ratio over the
 * absolute numbers when rendering.
 */
export type BackfillProgress = {
  completed: number;
  total: number;
};

/**
 * Ephemeral, in-memory store of per-link backfill progress, written by the
 * `backfill_progress` handler in `sync.ts` and read by the inbox sync UI. An
 * entry exists only while a link is actively backfilling; it's removed on
 * completion, failure, or link removal. Not persisted — on reload the coarse
 * `sync_status` from the links query takes over until the next event arrives.
 */
const [progressByLink, setProgressByLink] = createSignal<
  Map<string, BackfillProgress>
>(new Map());

/** Record the latest progress for a link, replacing any previous value. */
export function setBackfillProgress(
  linkId: string,
  progress: BackfillProgress
): void {
  setProgressByLink((prev) => {
    const next = new Map(prev);
    next.set(linkId, progress);
    return next;
  });
}

/** Drop a link's progress entry (on completion, failure, or link removal). */
export function clearBackfillProgress(linkId: string): void {
  setProgressByLink((prev) => {
    if (!prev.has(linkId)) return prev;
    const next = new Map(prev);
    next.delete(linkId);
    return next;
  });
}

/**
 * Current backfill progress for a link, or `undefined` if it isn't actively
 * backfilling. Call inside a reactive scope to track updates.
 */
export function getBackfillProgress(
  linkId: string
): BackfillProgress | undefined {
  return progressByLink().get(linkId);
}

/**
 * Lists every backfill job for the user. Fired when the email settings open, to
 * surface COMPLETED backfills. In-progress backfills are driven by the live
 * progress store above (connection-gateway events), not this query — its counts
 * can lag the live counters — so consumers should read this only for terminal
 * (e.g. completed) jobs.
 */
export function useBackfillJobsQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.backfillJobs.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await emailClient.listBackfillJobs()),
  }));
}

/**
 * Refetch the backfill jobs list. Call on terminal backfill events so the
 * settled "completed" state updates even while the email settings stay open
 * (the query otherwise only fires on mount).
 */
export function invalidateBackfillJobs() {
  queryClient.invalidateQueries({
    queryKey: emailKeys.backfillJobs.queryKey,
  });
}
