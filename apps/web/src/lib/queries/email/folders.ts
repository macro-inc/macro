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
    const outcomes = await Promise.allSettled(
      ids.map((threadId) =>
        throwOnErr(() =>
          updateEmailThreadState({
            thread_id: threadId,
            field: input.folder === 'spam' ? 'junk' : 'trashed',
            value: false,
          })
        )
      )
    );
    const restoredIds = ids.filter(
      (_, i) => outcomes[i].status === 'fulfilled'
    );
    const failedIds = ids.filter((_, i) => outcomes[i].status === 'rejected');
    span.setAttr('email.restore.failed_count', failedIds.length);
    if (failedIds.length) span.error('Some mailbox restores failed');
    if (restoredIds.length) {
      await Promise.all(
        restoredIds.map(async (id) => {
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
