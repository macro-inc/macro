import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import { queryClient } from '@queries/client';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
  ws,
} from '@service-connection/websocket';
import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import { scheduledActionKeys } from './keys';

/** What the scheduler pushes as a background draft moves along. */
const DRAFT_UPDATE = 'routine_draft_update';

// Only the fields used here; progress is applied as the server words it.
const updateSchema = z.object({
  draftId: z.string().min(1),
  state: z.enum(['drafting', 'ready', 'failed', 'removed']),
  progress: z.object({
    stage: z.enum(['started', 'found', 'writing', 'checked', 'fixing']),
    found: z.number().nullish(),
    check: z.unknown().nullish(),
  }),
});

/**
 * Jobs this page discarded. A read that started before the discard can still
 * list one, and must not bring it back.
 */
const discarded: string[] = [];

export function isDiscarded(draftId: string): boolean {
  return discarded.includes(draftId);
}

export function forgetDiscarded(draftId: string): void {
  const index = discarded.indexOf(draftId);
  if (index !== -1) discarded.splice(index, 1);
}

/** Take a job out of the list, and keep it out. */
export function removeDraftJob(draftId: string): void {
  if (!isDiscarded(draftId)) discarded.push(draftId);
  queryClient.setQueryData(
    scheduledActionKeys.draftJobs.queryKey,
    (current: DraftJob[] | undefined) =>
      current?.filter((job) => job.id !== draftId)
  );
}

function refetchDraftJobs() {
  queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.draftJobs.queryKey,
  });
}

/**
 * Apply one update to the cached list. Progress patches the job in place;
 * a finished job is read again for its draft or its reason.
 */
export function applyDraftUpdate(data: unknown): void {
  const parsed = updateSchema.safeParse(
    parseWebsocketPayload(DRAFT_UPDATE, data)
  );
  if (!parsed.success) return;
  const update = parsed.data;
  if (update.state === 'removed') {
    queryClient.setQueryData(
      scheduledActionKeys.draftJobs.queryKey,
      (current: DraftJob[] | undefined) =>
        current?.filter((job) => job.id !== update.draftId)
    );
    return;
  }
  if (isDiscarded(update.draftId)) return;
  const jobs = queryClient.getQueryData<DraftJob[]>(
    scheduledActionKeys.draftJobs.queryKey
  );
  // Nobody here reads drafts yet.
  if (!jobs) return;
  const job = jobs.find((each) => each.id === update.draftId);
  if (update.state !== 'drafting' || !job || job.state !== 'drafting') {
    // Finished, or started elsewhere (another tab, another device).
    refetchDraftJobs();
    return;
  }
  queryClient.setQueryData(
    scheduledActionKeys.draftJobs.queryKey,
    jobs.map((each) =>
      each.id === update.draftId
        ? { ...each, progress: update.progress as DraftJob['progress'] }
        : each
    )
  );
}

createConnectionWebsocketEffect((message) => {
  if (message.type !== DRAFT_UPDATE) return;
  applyDraftUpdate(message.data);
});

// Updates sent while the connection was down are gone; read the list again.
createReconnectEffect(ws, refetchDraftJobs);
