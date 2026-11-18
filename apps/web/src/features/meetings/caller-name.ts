import { idToDisplayName } from '@core/user/util';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';

/**
 * The name an incoming call shows for its caller, the same as channel call
 * banners and the Chat sidebar: the full name, else the address's local part.
 * Waits (bounded) for the name to load first, since an invitation keeps the
 * name it was given.
 */
export async function callerDisplayName(userId: string) {
  await DefaultUserNameResolver(userId);
  return idToDisplayName(userId) || undefined;
}
