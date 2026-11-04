import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';

/** Eligible people outside the roster, excluding agents. */
export function nonTeamUserOptions(
  users: IUser[],
  otherUsers: IUser[]
): IUser[] {
  const userIds = new Set(users.map((user) => user.id));
  return otherUsers.filter(
    (user) => !userIds.has(user.id) && !isBotPrincipalId(user.id)
  );
}

/** Switch views without dropping selected references from the main list. */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  selectedIds: ReadonlySet<string>,
  discovering: boolean
): IUser[] {
  const rosterIds = new Set(users.map((user) => user.id));
  const available = discovering
    ? nonTeamUserOptions(users, otherUsers)
    : [...users, ...otherUsers.filter((user) => selectedIds.has(user.id))];
  const options = new Map(available.map((user) => [user.id, user]));

  for (const id of selectedIds) {
    if (options.has(id)) continue;
    if (discovering && (rosterIds.has(id) || isBotPrincipalId(id))) continue;
    options.set(id, {
      id,
      email: isBotPrincipalId(id) ? '' : idToEmail(id),
      name: isBotPrincipalId(id) ? 'Agent' : idToDisplayName(id),
    });
  }
  return [...options.values()];
}
