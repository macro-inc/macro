import { withAnalytics } from '@coparse/analytics';
import type { IOrganizationUser } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { organizationServiceClient } from '@service-organization/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createEffect, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

const { track, TrackingEvents } = withAnalytics();

const useActiveTable = createSingletonRoot(() => {
  const [store, setStore] = createStore<{
    users: Array<IOrganizationUser | null>;
    pageIdx: number;
    pageSize: number;
  }>({
    users: [],
    pageIdx: 0,
    pageSize: 10,
  });

  const getUsers = async (limit: number = 10, offset: number = 0) => {
    if (store.users.length > 0 && store.users[offset]) return;
    const users = await organizationServiceClient.getUsers({ limit, offset });
    if (!users || isErr(users)) return;
    const [_, data] = users;

    if (store.users.length === 0) {
      const nulls = Array.from({
        length: data.total - data.users.length,
      }).map(() => null);
      setStore('users', [...data.users, ...nulls]);
      return;
    }

    setStore(
      'users',
      store.users.map((user, idx) => {
        if (idx >= offset && idx < offset + data.users.length) {
          return data.users[idx - offset];
        }
        return user;
      })
    );
  };

  const patchUserRole = async (
    userId: string,
    role: 'owner' | 'member',
    cb: Function
  ) => {
    try {
      const data = await organizationServiceClient.patchUserRole({
        userId,
        role,
      });
      if (isErr(data)) throw new Error('Failed to update user role');
      setStore(
        'users',
        store.users.map((user) => {
          if (user?.id === userId) {
            return {
              ...user,
              is_it_admin: role === 'owner',
            };
          }
          return user;
        })
      );
      track(TrackingEvents.ORGANIZATION.MEMBERS.UPDATE, {
        role,
      });
      cb();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      const data = await organizationServiceClient.deleteUser({ userId });
      if (isErr(data)) throw new Error('Failed to delete user');

      setStore(
        'users',
        store.users.filter((user) => user?.id !== userId)
      );
      track(TrackingEvents.ORGANIZATION.MEMBERS.DELETE);
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch and set users
  createEffect(() => getUsers(store.pageSize, store.pageIdx * store.pageSize));

  const pageIdxs = createMemo(() => {
    const { users, pageSize, pageIdx } = store;
    const totalUsers = users.length;
    const maxPageIdx = Math.ceil(totalUsers / pageSize) - 1;

    if (maxPageIdx < 3) {
      // If there are less than 4 pages, show all
      // return Array.from({ length: maxPageIdx }, (_, i) => i);
      return [0];
    }

    if (pageIdx === 0) {
      // If on the first page, show first three pages and the last page
      return [0, 1, 2];
    }

    if (pageIdx === maxPageIdx) {
      // If on the last page, show first page and the last three pages
      return [maxPageIdx - 2, maxPageIdx - 1, maxPageIdx];
    }

    // If on a middle page, show previous, current, next, and last page
    return [pageIdx - 1, pageIdx, pageIdx + 1];
  });

  const userPageSlice = createMemo(() => {
    return store.users.slice(
      store.pageIdx * store.pageSize,
      (store.pageIdx + 1) * store.pageSize
    );
  });

  const showingText = createMemo(() => {
    const start = store.pageIdx * store.pageSize + 1;
    const end = Math.min(
      store.users.length,
      (store.pageIdx + 1) * store.pageSize
    );
    return `${start}-${end}`;
  });

  const changePageIdx = (newPageIdx: number) => {
    const maxPageIdx = Math.ceil(store.users.length / store.pageSize) - 1;
    if (newPageIdx < 0 || newPageIdx > maxPageIdx) return;
    setStore('pageIdx', newPageIdx);
  };

  return {
    orgActiveStore: store,
    getUsers,
    patchUserRole,
    deleteUser,
    pageIdxs,
    userPageSlice,
    showingText,
    changePageIdx,
  };
});

export default useActiveTable;
