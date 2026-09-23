import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';

/** Provider operations used by email's production adapters alongside shared mutations. */
export const scheduleEmailMessage = (
  ...args: Parameters<typeof emailClient.scheduleMessage>
) => throwOnErr(() => emailClient.scheduleMessage(...args));
/** REST archive writes must revalidate the separate GraphQL list cache, also
 * for undo/redo and failures whose server outcome may be uncertain. */
export async function archiveEmailThread(
  ...args: Parameters<typeof emailClient.flagArchived>
) {
  try {
    return await throwOnErr(() => emailClient.flagArchived(...args));
  } finally {
    if (isFeatureEnabled(enableGraphqlSoup)) {
      await refreshActiveGraphqlSoupQueries();
    }
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
  return storageServiceClient.editDocument({
    documentId: attachmentId,
    sharePermission: { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' },
  });
}
