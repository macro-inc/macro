import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';
import { initiativeClient } from '@service-storage/initiative';

/** The shared share dialog owns loading and refreshing these permissions. */
export async function fetchInitiativeSharePermissions(initiativeId: string) {
  const result = await initiativeClient.get(initiativeId);
  return result.map((initiative) => initiative.sharePermission);
}

export function updateInitiativeSharePermissions(
  initiativeId: string,
  sharePermission: UpdateSharePermissionRequestV2
) {
  return initiativeClient.update(initiativeId, { sharePermission });
}
