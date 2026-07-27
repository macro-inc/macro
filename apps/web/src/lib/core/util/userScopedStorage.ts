/**
 * Safe, user-scoped localStorage access. Keys are namespaced per user id and
 * every storage failure (unavailable, blocked, full) degrades to "no value" /
 * no-op so in-memory state keeps working.
 */
export function createUserScopedStorage(baseKey: string) {
  const key = (userId: string) => `${baseKey}:${encodeURIComponent(userId)}`;
  return {
    read(userId: string): string | null {
      if (typeof localStorage === 'undefined') return null;
      try {
        return localStorage.getItem(key(userId));
      } catch {
        return null;
      }
    },
    write(userId: string, value: string): void {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(key(userId), value);
      } catch {
        // Storage may be unavailable or full. The in-memory state still works.
      }
    },
  };
}
