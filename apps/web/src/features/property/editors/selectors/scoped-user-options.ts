import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';

/** Keep selected users available without adding other non-team people. */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  selectedIds: ReadonlySet<string>
): IUser[] {
  const available = [
    ...users,
    ...otherUsers.filter((user) => selectedIds.has(user.id)),
  ];
  const options = new Map(available.map((user) => [user.id, user]));

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
