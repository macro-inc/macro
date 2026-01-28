import type { IOrganizationUser } from '@core/user';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

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

  const getUsers = async (_limit: number = 10, _offset: number = 0) => {
    // Organization service has been removed
  };

  const patchUserRole = async (
    _userId: string,
    _role: 'owner' | 'member',
    _cb: Function
  ) => {
    // Organization service has been removed
  };

  const deleteUser = async (_userId: string) => {
    // Organization service has been removed
  };

  const pageIdxs = createMemo(() => [0]);

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
