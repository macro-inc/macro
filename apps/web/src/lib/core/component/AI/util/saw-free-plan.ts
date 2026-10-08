import { createUserScopedStorage } from '@core/util/userScopedStorage';

const storage = createUserScopedStorage('agents-view-inmem-saw-free-v1');

/** Remember that this user has been on a free plan in this browser. */
export function noteSawFreePlan(userId: string | undefined) {
  if (!userId) return;
  if (storage.read(userId) === '1') return;
  storage.write(userId, '1');
}

/** Whether {@link noteSawFreePlan} has recorded a free plan for `userId`. */
export function hasSawFreePlan(userId: string | undefined): boolean {
  if (!userId) return false;
  return storage.read(userId) === '1';
}
