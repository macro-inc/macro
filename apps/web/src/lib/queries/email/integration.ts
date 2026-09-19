import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';

/** Provider operations used by email's production adapters alongside shared mutations. */
export const scheduleEmailMessage = (
  ...args: Parameters<typeof emailClient.scheduleMessage>
) => throwOnErr(() => emailClient.scheduleMessage(...args));
export const archiveEmailThread = (
  ...args: Parameters<typeof emailClient.flagArchived>
) => throwOnErr(() => emailClient.flagArchived(...args));
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
