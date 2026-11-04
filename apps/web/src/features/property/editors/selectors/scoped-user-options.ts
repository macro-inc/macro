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

/** Switch between the roster and other people while retaining selections and agents. */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  selectedIds: ReadonlySet<string>,
  discovering: boolean
): IUser[] {
  const options = new Map(
    users
      .filter(
        (user) =>
          !discovering || selectedIds.has(user.id) || isBotPrincipalId(user.id)
      )
      .map((user) => [user.id, user])
  );
  const available = discovering
    ? nonTeamUserOptions(users, otherUsers)
    : otherUsers.filter((user) => selectedIds.has(user.id));
  for (const user of available) {
    if (!options.has(user.id)) options.set(user.id, user);
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
