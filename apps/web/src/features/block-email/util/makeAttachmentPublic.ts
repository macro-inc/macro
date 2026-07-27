import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';

import { Telemetry } from '@macro-inc/observability';

import { storageServiceClient } from '@service-storage/client';

export const makeAttachmentPublic = async (attachmentId: string) => {
  const permissions = await storageServiceClient.getDocumentPermissions({
    document_id: attachmentId,
  });
  if (!permissions.isErr()) {
    if (permissions.value.isPublic) {
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
  if (!result.isErr()) {
    toast.success('Recipients can now view this file', {
      subtext: 'File share permissions have been updated to public view-only',
    });
    analytics.track('share_entity', {
      entityType: 'email_attachment',
      entityId: attachmentId,
      shareMethod: 'attachment_public',
      accessLevel: 'view',
    });
  } else {
    toast.alert('Recipients may not be able to view this file', {
      subtext: 'Please consult the document owner to change share permissions',
    });
    Telemetry.error('Failed to make attachment public', {
      errors: JSON.stringify(result.error),
    });
  }
};
