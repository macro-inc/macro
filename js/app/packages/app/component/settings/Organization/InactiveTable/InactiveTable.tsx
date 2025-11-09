import type { ComponentProps } from 'solid-js';
import { createMemo, For, splitProps } from 'solid-js';
import useInactiveTable from './useInactiveTable';

const UserRow = ({
  email,
  revokeUserInvite,
}: {
  email: string;
  revokeUserInvite: (email: string) => void;
}) => {
  const handleRevoke = () => revokeUserInvite(email);
  return (
    <tr class="mb-[2px] border-edge border-b">
      <td class="px-2 py-[4px] border-r border-edge" colSpan={3}>
        <div class="text-ink-muted text-xs leading-5 -mt-1 overflow-ellipsis overflow-hidden text-nowrap">
          {email}
        </div>
      </td>
      <td class="px-5 relative text-xs" colSpan={1}>
        <button
          type="button"
          onClick={handleRevoke}
          class="text-failure hover:text-failure-ink"
        >
          Revoke
        </button>
      </td>
    </tr>
  );
};

const TableButton = (
  props: ComponentProps<'button'> & { active?: boolean }
) => {
  const [local, others] = splitProps(props, ['active']);

  return (
    <button
      class={`px-1 py-1 min-w-9 text-sm font-normal text-ink-muted border border-edge rounded hover:bg-hover hover:border-ink-extra-muted transition-none hover:transition duration-200 ease-in disabled:pointer-events-none ${
        local.active ? 'bg-active' : ''
      }`}
      {...others}
    />
  );
};

const InactiveTable = () => {
  const {
    orgInactiveStore,
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
  } = useInactiveTable();

  const hasNext = createMemo(
    () =>
      orgInactiveStore.pageIdx <
      Math.ceil(orgInactiveStore.users.length / orgInactiveStore.pageSize) - 1
  );
  const hasPrev = createMemo(() => orgInactiveStore.pageIdx > 0);

  return (
    <div class="relative mb-8">
      <form class="mb-8" onSubmit={onSubmit}>
        <div class="flex relative">
          <input
            type="text"
            name="email"
            class="block w-full p-2 text-ink border border-edge rounded-lg bg-edge/15 text-xs focus:border-accent"
            placeholder="Enter email address"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            required
          />
          <button
            type="submit"
            class="ml-2 px-4 font-semibold text-xs text-md text-accent-ink ring-1 ring-accent/50 bg-accent/10 hover:bg-accent/20 rounded-md transition-none hover:transition ease-in-out"
            style={{
              opacity: !email() || loading() ? '50%' : '100%',
              cursor: !email() || loading() ? 'not-allowed' : 'pointer',
            }}
            disabled={!email() || loading()}
          >
            Invite
          </button>
          <p
            class="absolute bottom-0 right-0 text-xs pt-2 text-accent-ink transition ease-in-out"
            style={{
              transform: 'translateY(100%)',
              visibility: !message() ? 'hidden' : 'visible',
              color: !success() ? 'red' : 'inherit',
            }}
          >
            {message()}
          </p>
        </div>
      </form>
      <table class="table-fixed w-full text-sm text-left rtl:text-right text-ink-muted">
        <thead class="text-xs text-ink bg-edge/15">
          <tr>
            <th scope="col" colSpan={3} class="px-2 py-1">
              Email
            </th>
            <th scope="col" colSpan={1} class="px-6 py-1" />
          </tr>
        </thead>
        <tbody>
          <For
            each={userPageSlice()}
            fallback={
              <div class="px-2 py-2 text-xs text-ink-extra-muted">
                No invited members.
              </div>
            }
          >
            {(user) => (
              <UserRow revokeUserInvite={revokeUserInvite} email={user.email} />
            )}
          </For>
        </tbody>
      </table>
      <div class="flex justify-between items-center px-2 py-2">
        <div class="text-xs text-ink-muted">
          Showing <b>{showingText()}</b> of{' '}
          <b>{orgInactiveStore.users.length}</b>
        </div>
        <div class="flex space-x-1">
          <TableButton
            onClick={() => changePageIdx(orgInactiveStore.pageIdx - 1)}
            disabled={!hasPrev}
          >
            Prev
          </TableButton>

          <For each={pageIdxs()}>
            {(idx) => (
              <TableButton
                onClick={() => changePageIdx(idx)}
                active={orgInactiveStore.pageIdx === idx}
              >
                {idx + 1}
              </TableButton>
            )}
          </For>

          <TableButton
            onClick={() => changePageIdx(orgInactiveStore.pageIdx + 1)}
            disabled={!hasNext}
          >
            Next
          </TableButton>
        </div>
      </div>
    </div>
  );
};

export default InactiveTable;
