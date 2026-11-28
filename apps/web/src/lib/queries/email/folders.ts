import { Telemetry } from '@macro-inc/observability';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { emailKeys } from './keys';
import { setEmailMailboxFolderStates } from './mailbox-state';

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
    const outcomes = await span.run(() =>
      setEmailMailboxFolderStates(
        ids,
        input.folder === 'spam' ? 'JUNK' : 'TRASHED',
        false
      )
    );
    for (const [index, id] of ids.entries()) {
      if (outcomes[index].status === 'fulfilled') restoredIds.push(id);
      else failedIds.push(id);
    }
    span.setAttr('email.restore.failed_count', failedIds.length);
    if (failedIds.length) span.error('Some mailbox restores failed');
    if (restoredIds.length) {
      for (
        let start = 0;
        start < restoredIds.length;
        start += FOLDER_RESTORE_CONCURRENCY
      ) {
        // Keep the pending mailbox-operations reader in sync for open threads.
        const refreshes = await Promise.allSettled(
          restoredIds
            .slice(start, start + FOLDER_RESTORE_CONCURRENCY)
            .map((id) =>
              span.run(() =>
                queryClient.invalidateQueries({
                  queryKey: emailKeys.threadOperations(id).queryKey,
                })
              )
            )
        );
        if (refreshes.some((result) => result.status === 'rejected'))
          span.error('Mailbox restore refresh failed');
      }
      // A restored thread can enter legacy REST lists it was absent from.
      span.run(invalidateAllSoup);
    }
    return { restoredIds, failedIds };
  });
}

export function useRestoreEmailFolderMutation() {
  return useMutation(() => ({ mutationFn: restoreEmailFolderThreads }));
}
