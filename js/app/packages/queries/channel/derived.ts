import type { GetChannelResponse } from '@service-comms/generated/models';

/**
 * Check if the current user is an admin or owner of the channel
 */
export function isChannelAdminOrOwner(data: GetChannelResponse): boolean {
  const access = data.access;
  if (!access || access === 'NoAccess') return false;
  return ['admin', 'owner'].includes(access.Access.role);
}
