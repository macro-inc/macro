import { type Accessor, createMemo } from 'solid-js';
import { normalizeUserNameQueryId } from './user-name-cache';
import { userNameCache } from './user-name-cache-runtime';

export { normalizeUserNameQueryId } from './user-name-cache';

/** Non-suspending active participant labels, sharing the same scoped cache and
 * bounded batch scheduler as avatars. No separate query history or fetch queue. */
export function useUserNames(options: {
  userIds: Accessor<readonly string[]>;
  enabled?: Accessor<boolean>;
}) {
  const cache = userNameCache();
  const ids = createMemo(() => {
    if (options.enabled?.() === false) return [];
    return [
      ...new Set(
        options
          .userIds()
          .map(normalizeUserNameQueryId)
          .filter((id) => id !== null)
      ),
    ];
  });
  return createMemo(() => ids().map((id) => cache.read(id)));
}
