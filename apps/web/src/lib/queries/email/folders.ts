import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { invalidateAllSoup } from '../soup/normalized-cache';
import {
  refreshEmailThreadCache,
  updateEmailThreadState,
} from './cache-cleanup';
import { emailKeys } from './keys';

const FOLDER_RESTORE_CONCURRENCY = 8;

type RestoreFolderThreads = {
  folder: 'spam' | 'trash';
  threadIds: string[];
};

/** Provider-neutral writes also preserve per-thread authorization and pending state. */
export function restoreEmailFolderThreads(input: RestoreFolderThreads) {
  return Telemetry.span('email.folder.restore', async (span) => {
    const ids = [...new Set(input.threadIds)];
    span.setAttr('email.folder', input.folder);
    span.setAttr('email.thread.count', ids.length);
    const restoredIds: string[] = [];
    const failedIds: string[] = [];
    // Bound provider writes and their follow-up reads even for select-all.
    for (
      let start = 0;
      start < ids.length;
      start += FOLDER_RESTORE_CONCURRENCY
    ) {
      const batch = ids.slice(start, start + FOLDER_RESTORE_CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map((threadId) =>
          throwOnErr(() =>
            updateEmailThreadState({
              thread_id: threadId,
              field: input.folder === 'spam' ? 'junk' : 'trashed',
              value: false,
            })
          )
        )
      );
      for (const [index, id] of batch.entries()) {
        if (outcomes[index].status === 'fulfilled') restoredIds.push(id);
        else failedIds.push(id);
      }
    }
    span.setAttr('email.restore.failed_count', failedIds.length);
    if (failedIds.length) span.error('Some mailbox restores failed');
    if (restoredIds.length) {
      for (
        let start = 0;
        start < restoredIds.length;
        start += FOLDER_RESTORE_CONCURRENCY
      ) {
        // A failed refresh cannot turn an accepted provider write into a failed
        // restore. Keep the outcome and invalidate the lists for another read.
        const refreshes = await Promise.allSettled(
          restoredIds
            .slice(start, start + FOLDER_RESTORE_CONCURRENCY)
            .map(async (id) => {
              await refreshEmailThreadCache(id);
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: emailKeys.threadMessages(id).queryKey,
                }),
                queryClient.invalidateQueries({
                  queryKey: emailKeys.threadOperations(id).queryKey,
                }),
              ]);
            })
        );
        if (refreshes.some((result) => result.status === 'rejected'))
          span.error('Mailbox restore refresh failed');
      }
      // A restored thread can enter lists it was absent from, so refresh REST
      // membership and only the GraphQL lists not maintained by the snapshot.
      invalidateAllSoup();
      await refreshActiveGraphqlSoupQueries({ unmaintainedOnly: true });
    }
    return { restoredIds, failedIds };
  });
}

export function useRestoreEmailFolderMutation() {
  return useMutation(() => ({ mutationFn: restoreEmailFolderThreads }));
}
