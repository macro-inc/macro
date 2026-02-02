import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

const useInactiveTable = createSingletonRoot(() => {
  const [email, setEmail] = createSignal('');
  const [message, _setMessage] = createSignal('');
  const [success, _setSuccess] = createSignal(false);
  const [loading] = createSignal(false);

  const [store, setStore] = createStore<{
    users: { email: string }[];
    pageIdx: number;
    pageSize: number;
  }>({
    users: [],
    pageIdx: 0,
    pageSize: 10,
  });

  const showingText = createMemo(() => {
    const start = store.pageIdx * store.pageSize + 1;
    const end = Math.min(
      store.users.length,
      (store.pageIdx + 1) * store.pageSize
    );
    return `${start}-${end}`;
  });

  const revokeUserInvite = async (_email: string) => {
    // Organization service has been removed
  };

  const pageIdxs = createMemo(() => {
    const { users, pageSize, pageIdx } = store;
    const totalUsers = users.length;
    const maxPageIdx = Math.ceil(totalUsers / pageSize) - 1;

    if (maxPageIdx < 3) {
      return Array.from({ length: maxPageIdx + 1 }, (_, i) => i);
    }

    if (pageIdx === 0) {
      return [0, 1, 2];
    }

    if (pageIdx === maxPageIdx) {
      return [maxPageIdx - 2, maxPageIdx - 1, maxPageIdx];
    }

    return [pageIdx - 1, pageIdx, pageIdx + 1];
  });

  const userPageSlice = createMemo(() =>
    store.users.slice(
      store.pageIdx * store.pageSize,
      (store.pageIdx + 1) * store.pageSize
    )
  );

  const changePageIdx = (newPageIdx: number) => {
    const maxPageIdx = Math.ceil(store.users.length / store.pageSize) - 1;
    if (newPageIdx < 0 || newPageIdx > maxPageIdx) return;
    setStore('pageIdx', newPageIdx);
  };

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    // Organization service has been removed
  };

  return {
    orgInactiveStore: store,
    revokeUserInvite,
    loading,
    showingText,
    pageIdxs,
    changePageIdx,
    onSubmit,
    email,
    setEmail,
    success,
    message,
    userPageSlice,
  };
});

export default useInactiveTable;
