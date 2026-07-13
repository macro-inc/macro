import type {
  AccessLevel,
  EntityPermission,
  EntityPermissionResponse,
  ParticipantRole,
} from '@service-storage/generated/schemas';

type AccessResponse = Extract<EntityPermissionResponse, { status: 'access' }>;
type AccessLevelPermission = Extract<
  EntityPermission,
  { type: 'access_level' }
>;
type ChannelRolePermission = Extract<
  EntityPermission,
  { type: 'channel_role' }
>;

export function hasEntityAccess(
  response: EntityPermissionResponse
): response is AccessResponse {
  return response.status === 'access';
}

function isAccessLevelPermission(
  permission: EntityPermission
): permission is AccessLevelPermission {
  return permission.type === 'access_level';
}

function isChannelRolePermission(
  permission: EntityPermission
): permission is ChannelRolePermission {
  return permission.type === 'channel_role';
}

function _getEntityAccessLevel(
  response: EntityPermissionResponse
): AccessLevel | null {
  if (!hasEntityAccess(response)) {
    return null;
  }

  if (!isAccessLevelPermission(response.permission)) {
    return null;
  }

  return response.permission.access_level;
}

function _getEntityChannelRole(
  response: EntityPermissionResponse
): ParticipantRole | null {
  if (!hasEntityAccess(response)) {
    return null;
  }

  if (!isChannelRolePermission(response.permission)) {
    return null;
  }

  return response.permission.role;
}
