import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';

function userFromId(id: string): IUser {
  return {
    id,
    email: isBotPrincipalId(id) ? '' : idToEmail(id),
    name: isBotPrincipalId(id) ? 'Agent' : idToDisplayName(id),
  };
}

/**
 * The Assignees options: the viewer, the roster (team members and agents) and
 * recently selected users, each once. The viewer can always assign themselves,
 * also without a team, whose roster is empty. Recently selected users stay
 * available to remove and re-add without broadening the roster to other
 * non-team people.
 */
export function scopedUserOptions(
  users: IUser[],
  otherUsers: IUser[],
  retainedIds: readonly string[],
  viewerId: string | undefined
): IUser[] {
  const options = [...users];

  if (viewerId && !options.some((option) => option.id === viewerId)) {
    options.unshift(
      otherUsers.find((user) => user.id === viewerId) ?? userFromId(viewerId)
    );
  }

  for (const id of retainedIds) {
    const contact = otherUsers.find((user) => user.id === id);
    const member = users.find((user) => user.id === id);
    const user = contact ?? member ?? userFromId(id);
    const index = options.findIndex((option) => option.id === id);

    if (index === -1) {
      options.push(user);
    } else {
      options[index] = user;
    }
  }

  return options;
}
