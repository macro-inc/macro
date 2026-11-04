import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';

/** Keep selected outsiders available without exposing unselected contacts. */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  selectedIds: ReadonlySet<string>,
  includeOtherUsers: boolean
): IUser[] {
  const options = new Map(users.map((user) => [user.id, user]));
  for (const user of otherUsers) {
    if (options.has(user.id)) continue;
    if (includeOtherUsers || selectedIds.has(user.id)) {
      options.set(user.id, user);
    }
  }
  for (const id of selectedIds) {
    if (options.has(id)) continue;
    options.set(id, {
      id,
      email: isBotPrincipalId(id) ? '' : idToEmail(id),
      name: isBotPrincipalId(id) ? 'Agent' : idToDisplayName(id),
    });
  }
  return [...options.values()];
}
