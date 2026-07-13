import { useDmActivityByUserId } from '@core/context/channels';
import type { IUser } from './types';

export function useAugmentUserWithDmActivity() {
  const getDmActivity = useDmActivityByUserId();

  return (user: IUser): IUser => {
    const dmTimestamp = getDmActivity().get(user.id);
    return {
      ...user,
      lastInteraction: dmTimestamp,
    };
  };
}
