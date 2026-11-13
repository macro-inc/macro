import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { Telemetry } from '@macro-inc/observability';
import {
  queryAccountSession,
  queryAccountSessionPending,
} from '@queries/auth/account-scope';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';
import { clampDescription } from '../core/routine-draft';
import {
  COMPOSE_FAILED,
  type ComposerContext,
  draftContext,
  draftFromRoutine,
  RETRY_DELAY_MS,
  requestFailure,
  unanswered,
} from './compose-routine';
import {
  forgetDiscarded,
  isDiscarded,
  removeDraftJob,
} from './draft-jobs-sync';
import { scheduledActionKeys } from './keys';

const TOO_MANY =
  'Too many routines are drafting. Wait for one to finish, or cancel one.';
const SIGNED_IN_AGAIN = 'You signed in again while this draft was starting.';

/**
 * The caller's routine drafts: the background drafts New routine started,
 * newest first. Live updates keep it current (`draft-jobs-sync`).
 */
export function routineDraftJobsQueryOptions() {
  return queryOptions({
    queryKey: scheduledActionKeys.draftJobs.queryKey,
    queryFn: fetchDraftJobs,
    // Updates arrive over the connection, and it refetches after reconnecting.
    staleTime: 60_000,
    retry: retryDraftJobsRead,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS),
  });
}

/** How many times a failed read of the list is tried again, about 35 s in all. */
const READ_RETRIES = 6;
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * A finished draft is read again for its draft or its reason, and that read
 * can land while the replica that drafted it shuts down (a draft it
 * interrupts fails then). Keep trying past the restart, so its toast still
 * comes; a refused sign-in won't change by trying.
 */
function retryDraftJobsRead(failureCount: number, error: Error): boolean {
  if (
    thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(error, 'FORBIDDEN')
  ) {
    return false;
  }
  return failureCount < READ_RETRIES;
}

async function fetchDraftJobs(): Promise<DraftJob[]> {
  const jobs = await throwOnErr(() =>
    scheduledActionClient.listRoutineDraftJobs()
  );
  // A job discarded here may still be listed by a read that started first.
  return jobs.filter(
    (job) => job.request.kind === 'routine' && !isDiscarded(job.id)
  );
}

/**
 * The caller's routine drafts; empty until they're read or while `enabled`
 * is false. A read again that fails keeps the list it had. A login that
 * replaces the session forgets them (`resetQueryAccountSession`), and they
 * are read again once the new session is confirmed.
 */
export function useDraftJobs(enabled: Accessor<boolean>) {
  const query = useQuery(() => ({
    ...routineDraftJobsQueryOptions(),
    enabled: enabled() && !queryAccountSessionPending(),
  }));
  return {
    jobs: (): DraftJob[] => (query.isPending ? [] : (query.data ?? [])),
    /** Whether a read succeeded: a first read that failed listed nothing. */
    loaded: () => !query.isPending && query.data !== undefined,
  };
}

/**
 * Put a job at the top of the list. A read already under way may have
 * missed it and would write over it, so that one is read again. One
 * removed elsewhere meanwhile stays out. Nothing is listed across a login
 * that replaced the session, nor while it waits to be confirmed: listed,
 * it would stand for the new login's list, which then isn't read.
 */
async function listDraftJob(job: DraftJob) {
  const login = queryAccountSession();
  const queryKey = scheduledActionKeys.draftJobs.queryKey;
  const reading = queryClient.isFetching({ queryKey }) > 0;
  if (reading) await queryClient.cancelQueries({ queryKey });
  const listable =
    queryAccountSession() === login &&
    !queryAccountSessionPending() &&
    !isDiscarded(job.id);
  if (listable) {
    queryClient.setQueryData(queryKey, (current: DraftJob[] | undefined) =>
      withDraftJob(current ?? [], job)
    );
  }
  if (reading) queryClient.invalidateQueries({ queryKey });
}

/**
 * The list with `job` at the top, unless it lists that job further along:
 * its updates can arrive before the answer that started it.
 */
function withDraftJob(jobs: DraftJob[], job: DraftJob): DraftJob[] {
  const listed = jobs.find((each) => each.id === job.id);
  const further =
    listed && (listed.state !== 'drafting' || job.state === 'drafting');
  if (further) return jobs;
  return [job, ...jobs.filter((each) => each.id !== job.id)];
}

/**
 * Start drafting a routine from a description in the background. Resolves
 * once drafting is under way, with the job, or with why it didn't start.
 *
 * The start is idempotent by its client id: when the connection drops
 * before the answer, it's sent once more and answers with the job the first
 * one began, if it did.
 */
export async function startDraftJob(
  description: string,
  context: ComposerContext
): Promise<DraftJob | string> {
  return await Telemetry.span('routine.draft', async (span) => {
    span.setAttr('routine.draft.kind', 'routine');
    span.setAttr('routine.draft.background', true);
    const login = queryAccountSession();
    const body = {
      clientId: crypto.randomUUID(),
      draft: { type: 'routine' as const, description },
      context: draftContext(context),
    };
    // Each attempt starts inside the span, so its request joins this trace,
    // and so does the drafting the server goes on with.
    const send = () =>
      span.run(() => scheduledActionClient.startRoutineDraftJob(body));
    let response = await send();
    let attempts = 1;
    if (response.isErr() && unanswered(response.error)) {
      await sleep(RETRY_DELAY_MS);
      response = await send();
      attempts = 2;
    }
    span.setAttr('routine.draft.attempts', attempts);
    if (response.isErr()) {
      span.setAttr('routine.draft.outcome', 'request_failed');
      span.setAttr('routine.draft.error', response.error[0]?.code ?? 'unknown');
      span.error('Routine draft start failed');
      handleAiUsageLimitError(response.error);
      if (response.error.some((error) => error.code === 'TOO_MANY')) {
        return TOO_MANY;
      }
      return requestFailure(response.error, COMPOSE_FAILED);
    }
    const job = response.value;
    span.setAttr('routine.draft.id', job.id);
    // The job is the previous login's: this one may be another account's.
    if (queryAccountSession() !== login) {
      span.setAttr('routine.draft.outcome', 'login_replaced');
      return SIGNED_IN_AGAIN;
    }
    span.setAttr('routine.draft.outcome', job.state);
    // One that finished already (refused at once, or a resend of a start
    // that ran) goes to the caller only, so nothing else reports it; a
    // caller that can't show it any more hands it on (`reportDraftJob`).
    if (job.state === 'drafting') await listDraftJob(job);
    return job;
  });
}

/**
 * Hand a finished draft the caller can no longer show to the app's pill and
 * toasts, by listing it.
 */
export async function reportDraftJob(job: DraftJob): Promise<void> {
  await listDraftJob(job);
}

/**
 * Cancel a draft still drafting, or discard a finished one. It leaves the
 * list at once; the server is told after.
 */
export function discardDraftJob(draftId: string): void {
  removeDraftJob(draftId);
  fireAndForget(sendDiscard(draftId), 'routines');
}

async function sendDiscard(draftId: string) {
  await Telemetry.span('routine.draft.discard', async (span) => {
    span.setAttr('routine.draft.id', draftId);
    const result = await span.run(() =>
      scheduledActionClient.discardRoutineDraftJob({ draftId })
    );
    // Gone already: discarded elsewhere, or cleaned up.
    if (
      result.isErr() &&
      !result.error.some((error) => error.code === 'NOT_FOUND')
    ) {
      span.error('Routine draft discard failed');
      // It is listed again, and can be discarded again.
      forgetDiscarded(draftId);
      queryClient.invalidateQueries({
        queryKey: scheduledActionKeys.draftJobs.queryKey,
      });
    }
  });
}

/** A background draft that finished with a draft to open. */
export type ReadyDraftJob = Extract<DraftJob, { state: 'ready' }>;

/** What a finished draft is called: its routine's name, else what was asked. */
export function draftJobName(job: ReadyDraftJob): string {
  if (job.draft.outcome === 'routine' && job.draft.name) return job.draft.name;
  return job.request.description;
}

/**
 * A finished draft as the new routine's first draft, described by what was
 * asked for, or why it can't be one.
 */
export function draftFromJob(
  job: ReadyDraftJob,
  defaultModel: string
): ScheduleDraft | string {
  if (job.draft.outcome !== 'routine') return COMPOSE_FAILED;
  const draft = draftFromRoutine(job.draft, defaultModel);
  if (typeof draft === 'string') return draft;
  const description = clampDescription(job.request.description);
  return { ...draft, ...(description ? { description } : {}) };
}
