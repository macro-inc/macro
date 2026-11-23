import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';

/** Keep recently selected users available to remove and re-add without
 * broadening the roster to other non-team people. */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  retainedIds: readonly string[]
): IUser[] {
  const options = [...users];

  for (const id of retainedIds) {
    const contact = otherUsers.find((user) => user.id === id);
    const member = users.find((user) => user.id === id);
    const user = contact ??
      member ?? {
        id,
        email: isBotPrincipalId(id) ? '' : idToEmail(id),
        name: isBotPrincipalId(id) ? 'Agent' : idToDisplayName(id),
      };
    const index = options.findIndex((option) => option.id === id);

    if (index === -1) {
      options.push(user);
    } else {
      options[index] = user;
    }
  }

  return options;
}
