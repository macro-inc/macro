import type {
  AccessLevel,
  EntityPermissionSchema,
  EntityPermissionResponse,
  ParticipantRole,
} from '@service-storage/generated/schemas';

type AccessResponse = Extract<EntityPermissionResponse, { status: 'access' }>;
type AccessLevelPermission = Extract<
  EntityPermissionSchema,
  { type: 'access_level' }
>;
type ChannelRolePermission = Extract<
  EntityPermissionSchema,
  { type: 'channel_role' }
>;

export function hasEntityAccess(
  response: EntityPermissionResponse
): response is AccessResponse {
  return response.status === 'access';
}

export function isAccessLevelPermission(
  permission: EntityPermissionSchema
): permission is AccessLevelPermission {
  return permission.type === 'access_level';
}

export function isChannelRolePermission(
  permission: EntityPermissionSchema
): permission is ChannelRolePermission {
  return permission.type === 'channel_role';
}

export function getEntityAccessLevel(
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

export function getEntityChannelRole(
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
