import { fireAndForget } from '@core/util/fireAndForget';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';
import { whatsappGroupsClient } from '@service-storage/whatsapp-groups';
import { invalidateWhatsappGroups } from './index';

export function fetchWhatsappGroupPermissions(groupId: string) {
  return whatsappGroupsClient.permissions(groupId);
}
export async function updateWhatsappGroupPermissions(
  groupId: string,
  request: UpdateSharePermissionRequestV2
) {
  const result = await whatsappGroupsClient.updatePermissions(groupId, request);
  if (result.isOk())
    fireAndForget(invalidateWhatsappGroups(), 'whatsapp-group.share');
  return result;
}
