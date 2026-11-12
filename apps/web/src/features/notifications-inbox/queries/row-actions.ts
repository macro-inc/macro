import { throwOnErr } from '@core/util/result';
import { refreshSharedAccess } from '@queries/access-requests/requests';
import { accessRequestsClient } from '@service-storage/access-requests';
import { ShareEntityType } from '@service-storage/generated/schemas/shareEntityType';
import type { AccessRequest } from '../context/notifications-inbox-context';

const shareEntityType = (type: string) =>
  Object.values(ShareEntityType).find((candidate) => candidate === type);

/**
 * Approve an access request at the level asked for, or deny it. Resolving
 * supersedes the request's notification for every reviewer.
 */
export async function resolveAccessRequest(
  request: AccessRequest,
  approve: boolean
): Promise<void> {
  const entityType = shareEntityType(request.entityType);
  if (!entityType) throw new Error('Access requests are not supported here');
  const entity = { entityType, entityId: request.entityId };
  await throwOnErr(() =>
    accessRequestsClient.resolve(
      entity,
      request.requestId,
      request.revision,
      approve ? request.level : null
    )
  );
  refreshSharedAccess(entity);
}
