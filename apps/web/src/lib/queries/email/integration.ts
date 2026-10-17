import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import { setGraphqlEmailThreadArchived } from '@service-storage/graphql-email-archive-state';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { invalidateEmailReminderCollection } from '../reminders/email-collection';
import {
  getActiveGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';

/** Provider operations used by email's production adapters alongside shared mutations. */
export const scheduleEmailMessage = (
  ...args: Parameters<typeof emailClient.scheduleMessage>
) => throwOnErr(() => emailClient.scheduleMessage(...args));
export type EmailArchiveDisposition = 'committed' | 'queued';

/** Shared archive path for Done, Not Done, send completion, and Undo/Redo.
 * GraphQL owns optimistic state and durable replay. The optimistic
 * `inboxVisible` and the committed record update every list the cache
 * maintains (FE-56); only the others, such as grouped lists, are read again
 * when the write commits, including on a replay after reload. */
export async function archiveEmailThread(
  ...args: Parameters<typeof emailClient.flagArchived>
): Promise<EmailArchiveDisposition> {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const [{ id, value }] = args;
    const disposition = await setGraphqlEmailThreadArchived(
      getGraphqlSoupClient(),
      id,
      value,
      getActiveGraphqlSoupRevalidations(undefined, { unmaintainedOnly: true })
    );
    if (disposition === 'committed') {
      if (!graphqlCacheEnabled()) {
        await refreshActiveGraphqlSoupQueries({
          target: { kind: 'email-archive', threadId: id },
        });
      }
      void invalidateEmailReminderCollection();
    }
    return disposition;
  }
  await throwOnErr(() => emailClient.flagArchived(...args));
  void invalidateEmailReminderCollection();
  return 'committed';
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
  return storageServiceClient.editDocument({
    documentId: attachmentId,
    sharePermission: { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' },
  });
}
