import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { emailKeys } from './keys';

/** Most recent progress readings kept per link, for the time-remaining estimate. */
const MAX_PROGRESS_SAMPLES = 5;

/** A timestamped progress reading, used to estimate the recent backfill rate. */
export type BackfillSample = {
  /** Wall-clock receive time of the `backfill_progress` event, in ms. */
  at: number;
  /** `completed_threads` reported at that time. */
  completed: number;
};

/**
 * How far along a link's backfill is, as last reported by a `backfill_progress`
 * websocket event. `completed`/`total` mirror the backend's `completed_threads`
 * / `total_threads`. Both can read slightly above the real mailbox size — the
 * priority pass inflates them in lockstep — so prefer the ratio over the
 * absolute numbers when rendering. `samples` holds the most recent readings
 * (oldest→newest, capped at MAX_PROGRESS_SAMPLES) used to estimate time left.
 */
export type BackfillProgress = {
  completed: number;
  total: number;
  samples: BackfillSample[];
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

/**
 * Record a progress reading for a link, appending a timestamped sample (only
 * the most recent MAX_PROGRESS_SAMPLES are kept) so time remaining can be
 * estimated from the recent rate.
 */
export function setBackfillProgress(
  linkId: string,
  completed: number,
  total: number
): void {
  setProgressByLink((prev) => {
    const next = new Map(prev);
    const samples = [
      ...(prev.get(linkId)?.samples ?? []),
      { at: Date.now(), completed },
    ].slice(-MAX_PROGRESS_SAMPLES);
    next.set(linkId, { completed, total, samples });
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
 * Estimate seconds remaining from the recent backfill rate: the threads
 * completed and time elapsed across the sample window (the last up to
 * MAX_PROGRESS_SAMPLES events) give a threads/ms rate, divided into the threads
 * still left. Returns `undefined` until there are two samples, or when no
 * forward progress has been observed across the window.
 */
export function estimateEtaSeconds(
  progress: BackfillProgress
): number | undefined {
  const { samples, total, completed } = progress;
  if (samples.length < 2) return undefined;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const threadsDone = last.completed - first.completed;
  const elapsedMs = last.at - first.at;
  if (threadsDone <= 0 || elapsedMs <= 0) return undefined;

  const threadsLeft = Math.max(0, total - completed);
  const ratePerMs = threadsDone / elapsedMs;
  return threadsLeft / ratePerMs / 1000;
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
