import { tryMacroId } from '@core/user';
import { idToDisplayName } from '@core/user/util';
import { userNameCache } from '@queries/auth/user-name-cache-runtime';
import { raceTimeout, until } from '@solid-primitives/promise';

const NAME_LOAD_TIMEOUT_MS = 1000;

/**
 * The caller's name for a one-shot surface such as the OS notification: the
 * full name, else the address's local part, like channel call banners. Waits
 * (bounded) until the name cache has finished loading the caller, because the
 * display name reads as the address while it loads. In-app banners read
 * `idToDisplayName` reactively instead, so they update when the name arrives.
 */
export async function callerDisplayName(userId: string) {
  const id = tryMacroId(userId);
  if (id) {
    await raceTimeout(
      until(() => !userNameCache().read(id).loading),
      NAME_LOAD_TIMEOUT_MS
    );
  }
  return idToDisplayName(userId) || undefined;
}
