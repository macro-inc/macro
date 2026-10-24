import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import {
  setGraphqlEmailThreadArchived,
  setGraphqlEmailThreadsArchived,
} from '@service-storage/graphql-email-archive-state';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { invalidateEmailReminderCollection } from '../reminders/email-collection';
import {
  getActiveGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';
import { updateEntitySharePolicy } from '../storage/entity-mutations';

/** Provider operations used by email's production adapters alongside shared mutations. */
export const scheduleEmailMessage = (
  ...args: Parameters<typeof emailClient.scheduleMessage>
) => throwOnErr(() => emailClient.scheduleMessage(...args));
export type EmailArchiveDisposition = 'committed' | 'queued';

/** Shared archive path for Done, Not Done, send completion, and Undo/Redo.
 * GraphQL owns optimistic state and durable replay; queued writes must not
 * refetch the server's pre-write membership over the optimistic update. */
export async function archiveEmailThread(
  ...args: Parameters<typeof emailClient.flagArchived>
): Promise<EmailArchiveDisposition> {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const [{ id, value }] = args;
    const disposition = await setGraphqlEmailThreadArchived(
      getGraphqlSoupClient(),
      id,
      value,
      getActiveGraphqlSoupRevalidations()
    );
    if (disposition === 'committed') {
      await refreshActiveGraphqlSoupQueries({
        target: { kind: 'email-archive', threadId: id },
      });
      fireAndForget(invalidateEmailReminderCollection(), 'email-reminders');
    }
    return disposition;
  }
  await throwOnErr(() => emailClient.flagArchived(...args));
  fireAndForget(invalidateEmailReminderCollection(), 'email-reminders');
  return 'committed';
}

/** The email service's per-request cap (`MAX_BULK_ARCHIVE_THREADS`). */
const ARCHIVE_THREADS_PER_REQUEST = 100;

/** Bulk Done and Not Done: one request per 100 threads, so the server sends
 * Gmail one write per inbox rather than one per thread. Settles each thread as
 * `archiveEmailThread` would; a thread the server could not change rejects. */
export async function archiveEmailThreads(
  ids: string[],
  value: boolean
): Promise<PromiseSettledResult<EmailArchiveDisposition>[]> {
  const requests: Promise<PromiseSettledResult<EmailArchiveDisposition>[]>[] =
    [];
  for (let start = 0; start < ids.length; start += ARCHIVE_THREADS_PER_REQUEST)
    requests.push(
      archiveThreadsRequest(
        ids.slice(start, start + ARCHIVE_THREADS_PER_REQUEST),
        value
      )
    );
  const results = (await Promise.all(requests)).flat();
  if (
    results.some(
      (result) => result.status === 'fulfilled' && result.value === 'committed'
    )
  )
    fireAndForget(invalidateEmailReminderCollection(), 'email-reminders');
  return results;
}

async function archiveThreadsRequest(
  ids: string[],
  value: boolean
): Promise<PromiseSettledResult<EmailArchiveDisposition>[]> {
  const settle = (updated: ReadonlySet<string>) =>
    ids.map(
      (id): PromiseSettledResult<EmailArchiveDisposition> =>
        updated.has(id)
          ? { status: 'fulfilled', value: 'committed' }
          : {
              status: 'rejected',
              reason: new Error('Email thread archive state did not change'),
            }
    );
  try {
    if (isFeatureEnabled(enableGraphqlSoup)) {
      const result = await setGraphqlEmailThreadsArchived(
        getGraphqlSoupClient(),
        ids,
        value,
        getActiveGraphqlSoupRevalidations()
      );
      if (result.kind === 'queued')
        return ids.map(() => ({ status: 'fulfilled', value: 'queued' }));
      await Promise.all(
        [...result.updatedThreadIds].map((threadId) =>
          refreshActiveGraphqlSoupQueries({
            target: { kind: 'email-archive', threadId },
          })
        )
      );
      return settle(result.updatedThreadIds);
    }
    const response = await throwOnErr(() =>
      emailClient.flagArchivedBatch({ thread_ids: ids, value })
    );
    return settle(new Set(response.updated_thread_ids));
  } catch (reason) {
    return ids.map(() => ({ status: 'rejected', reason }));
  }
}

export const unscheduleEmailMessage = (
  ...args: Parameters<typeof emailClient.unscheduleMessage>
) => emailClient.unscheduleMessage(...args);
export const restoreEmailDraft = (
  ...args: Parameters<typeof emailClient.createDraft>
) => emailClient.createDraft(...args);
export const getEmailAttachmentDocument = (id: string) =>
  emailClient.getOrCreateAttachmentDocumentId({ id });
export const getEmailAttachmentMetadata = (documentId: string) =>
  storageServiceClient.getDocumentMetadata({ documentId });

export async function ensureEmailAttachmentPublic(attachmentId: string) {
  const permissions = await storageServiceClient.getDocumentPermissions({
    document_id: attachmentId,
  });
  if (
    permissions.isOk() &&
    permissions.value.linkShare === 'PUBLIC' &&
    permissions.value.linkShareAccessLevel === 'view'
  )
    return undefined;
  if (isFeatureEnabled(enableGraphqlSoup)) {
    return updateEntitySharePolicy('document', attachmentId, {
      linkShare: 'PUBLIC',
      linkShareAccessLevel: 'view',
    });
  }
  return storageServiceClient.editDocument({
    documentId: attachmentId,
    sharePermission: { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' },
  });
}
