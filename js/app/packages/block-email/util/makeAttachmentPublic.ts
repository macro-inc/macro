import { toast } from '@core/component/Toast/Toast';
import { isErr } from '@core/util/maybeResult';
import { logger } from '@observability';
import { storageServiceClient } from '@service-storage/client';

export const makeAttachmentPublic = async (attachmentId: string) => {
  const permissions = await storageServiceClient.getDocumentPermissions({
    document_id: attachmentId,
  });
  if (!isErr(permissions)) {
    if (permissions[1].isPublic) {
      return;
    }
  }
  // Change file permissions to public view-only
  const result = await storageServiceClient.editDocument({
    documentId: attachmentId,
    sharePermission: {
      isPublic: true,
      publicAccessLevel: 'view',
    },
  });
  if (!isErr(result)) {
    toast.success(
      'Recipients can now view this file',
      'File share permissions have been updated to public view-only'
    );
  } else {
    toast.alert(
      'Recipients may not be able to view this file',
      'Please consult the document owner to change share permissions'
    );
    logger.error('Failed to make attachment public', result);
  }
};
