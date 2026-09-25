import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import { setGraphqlEmailThreadArchived } from '@service-storage/graphql-email-archive-state';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
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
      await refreshActiveGraphqlSoupQueries();
    }
    return disposition;
  }
  await throwOnErr(() => emailClient.flagArchived(...args));
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
