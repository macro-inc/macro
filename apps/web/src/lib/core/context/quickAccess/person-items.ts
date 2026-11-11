import type { IUser } from '@core/user/types';
import type { UserItem } from './types';

/** Already-resolved labels never enter the global display-name store. */
export function contactUserItem(user: IUser): UserItem {
  const interaction = user.lastInteraction;
  const timestamp = interaction == null ? 0 : new Date(interaction).getTime();
  return {
    kind: 'user',
    bucket: 'person',
    id: user.id,
    data: user,
    searchText: `${user.name} | ${user.email}`,
    sortTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
    timestamps: { lastInteraction: interaction },
  };
}
