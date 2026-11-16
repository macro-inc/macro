import { queryClient } from '../client';
import { authKeys } from './keys';
import type { UserInfoData } from './user-info';

/** The signed-in user's id from cached user info, for code outside components. */
export function cachedUserId(): string | undefined {
  return (
    queryClient.getQueryData<UserInfoData>(authKeys.userInfo.queryKey)?.id ||
    undefined
  );
}
