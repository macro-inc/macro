import { withAnalytics } from '@coparse/analytics';
import { isErr } from '@core/util/maybeResult';
import { organizationServiceClient } from '@service-organization/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import { createStore } from 'solid-js/store';

const { track, TrackingEvents } = withAnalytics();

const useInactiveTable = createSingletonRoot(() => {
  const [email, setEmail] = createSignal('');

  const [message, setMessage] = createSignal('');
  const [success, setSuccess] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const [getInvitedUsers] = createResource(
    organizationServiceClient.getInvitedUsers
  );

  const [store, setStore] = createStore<{
    users: { email: string }[];
    pageIdx: number;
    pageSize: number;
  }>({
    users: [],
    pageIdx: 0,
    pageSize: 10,
  });

  // Fetch and set invited users
  createEffect(() => {
    const invitedUsers = getInvitedUsers();
    if (!invitedUsers || isErr(invitedUsers)) return;
    const [_, data] = invitedUsers;

    setStore(
      'users',
      data.invited_users.map((email: string) => ({ email }))
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

  // Clear message after 3 seconds
  createEffect(() => {
    if (message()) {
      const timeout = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timeout);
    }
  });

  // Revoke a user's invite
  const revokeUserInvite = async (email: string) => {
    try {
      const data = await organizationServiceClient.revokeUserInvite({ email });
      if (isErr(data)) {
        throw new Error('Failed to revoke user invite');
      }
      setStore('users', (prevUsers) =>
        prevUsers.filter((u) => u.email !== email)
      );

      // If the last user on the current page is removed, go back a page
      if (
        store.users.slice(
          store.pageIdx * store.pageSize,
          (store.pageIdx + 1) * store.pageSize
        ).length === 0 &&
        store.pageIdx > 0
      ) {
        setStore('pageIdx', store.pageIdx - 1);
      }
      track(TrackingEvents.ORGANIZATION.MEMBERS.REVOKE);
    } catch (_e) {
      console.error('Failed to revoke user invite');
    }
  };

  // Memoized computation of page indexes for pagination controls
  const pageIdxs = createMemo(() => {
    const { users, pageSize, pageIdx } = store;
    const totalUsers = users.length;
    const maxPageIdx = Math.ceil(totalUsers / pageSize) - 1;

    if (maxPageIdx < 3) {
      // If there are less than 4 pages, show all
      return Array.from({ length: maxPageIdx + 1 }, (_, i) => i);
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

  const userPageSlice = createMemo(() =>
    store.users.slice(
      store.pageIdx * store.pageSize,
      (store.pageIdx + 1) * store.pageSize
    )
  );

  // Function to change the current page index
  const changePageIdx = (newPageIdx: number) => {
    const maxPageIdx = Math.ceil(store.users.length / store.pageSize) - 1;
    if (newPageIdx < 0 || newPageIdx > maxPageIdx) return;
    setStore('pageIdx', newPageIdx);
  };

  // Handle form submission to invite a user
  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (loading() || !email()) return;

    setLoading(true);
    try {
      const inviteUser = await organizationServiceClient.inviteUser({
        email: email(),
      });
      if (isErr(inviteUser)) {
        // TODO: Retrieve and display the error message from the API
        throw new Error('Failed to invite user');
      }
      setStore('users', (prevUsers) => [...prevUsers, { email: email() }]);
      setSuccess(true);
      setMessage('An invitation email has been sent.');
      setEmail('');
      track(TrackingEvents.ORGANIZATION.MEMBERS.INVITE);
    } catch (e) {
      console.error('Failed to invite user', e);
      setSuccess(false);
      setMessage(e.message || 'Failed to invite user.');
    }
    setLoading(false);
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
