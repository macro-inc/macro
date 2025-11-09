import type { IOrganizationUser } from '@core/user';
import ArrowDown from '@icon/regular/arrow-down.svg';
import {
  type Component,
  type ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
} from 'solid-js';
import useActiveTable from './useActiveTable';

// Define the props interface
interface DeleteModalProps {
  email: string;
  onDelete: () => Promise<void>;
}
const DeleteModal: Component<DeleteModalProps> = ({ email, onDelete }) => {
  const [showModal, setShowModal] = createSignal(false);
  const [deleteCountdown, setDeleteCountdown] = createSignal(5);
  const allowDelete = () => deleteCountdown() === 0;

  const handleDelete = async () => {
    if (!allowDelete()) return;
    await onDelete();
    setShowModal(false);
  };

  createEffect(() => {
    if (!showModal()) {
      setDeleteCountdown(5);
      return;
    }

    if (showModal() && deleteCountdown() > 0) {
      const timer = setTimeout(() => {
        setDeleteCountdown(deleteCountdown() - 1);
      }, 1000);
      onCleanup(() => clearTimeout(timer));
    }
  });

  return (
    <>
      {/* Delete Button */}
      <button
        onClick={() => setShowModal(true)}
        class="text-xs text-failure hover:text-failure-ink"
      >
        Delete
      </button>

      {/* Modal */}
      <Show when={showModal()}>
        <div
          class="fixed inset-0 z-10 flex items-center justify-center bg-opacity-50"
          onClick={() => setShowModal(false)} // Close modal on background click
        >
          <div
            class="bg-dialog rounded-md shadow-md p-4 text-left"
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal
          >
            <h2 class="text-lg font-semibold text-ink">Delete User</h2>
            <p class="text-center text-xs my-4">{email}</p>
            <p class="text-xs text-ink-muted mt-2">
              By deleting this user, all of their data will be permanently lost.
              <br />
              Are you sure you want to continue?
            </p>
            <div class="flex justify-end mt-6">
              {/* Cancel Button */}
              <button
                onClick={() => setShowModal(false)}
                class="px-4 py-1 text-sm text-ink-muted hover:text-ink border border-edge rounded"
              >
                Cancel
              </button>
              {/* Delete Button */}
              <button
                onClick={handleDelete}
                class={`px-4 py-1 text-sm text-failure hover:text-failure-ink transition-none hover:transition ml-2 bg-failure-bg hover:bg-failure/50 rounded min-w-24 ${
                  !allowDelete() ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                disabled={!allowDelete()}
              >
                {allowDelete() ? 'Delete' : `Delete (${deleteCountdown()})`}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

interface UserRowProps extends IOrganizationUser {
  patchUserRole: (
    userId: string,
    role: 'owner' | 'member',
    cb: () => void
  ) => void;
  deleteUser: (userId: string) => Promise<void>;
}

const UserRow: Component<UserRowProps> = (props) => {
  // State to manage the visibility of the dropdown
  const [showDropdown, setShowDropdown] = createSignal(false);

  // Function to patch user role to Admin
  const patchUserAdmin = () => {
    props.patchUserRole(props.id, 'owner', () => {
      setShowDropdown(false);
    });
  };

  // Function to patch user role to Member
  const patchUserMember = () => {
    props.patchUserRole(props.id, 'member', () => {
      setShowDropdown(false);
    });
  };

  const handleDelete = async () => await props.deleteUser(props.id);

  return (
    <tr class="mb-[2px] border-b border-edge">
      {/* Email Cell */}
      <td class="px-2 py-[4px] border-r border-edge" colSpan={3}>
        <div class="text-ink-muted text-xs leading-5 -mt-1 overflow-ellipsis overflow-hidden whitespace-nowrap">
          {props.email}
        </div>
      </td>

      {/* Role Dropdown Cell */}
      <td class="px-5 relative" colSpan={3}>
        <button
          class="hover:bg-hover hover-transition-bg rounded-sm px-1 flex gap-1 items-center"
          onClick={() => setShowDropdown(!showDropdown())}
        >
          <span>{props.is_it_admin ? 'Admin' : 'Member'}</span>
          <ArrowDown class="w-3 h-3 pointer-events-none" />
        </button>

        {/* Dropdown Menu */}
        <Show when={showDropdown()}>
          <div
            onClick={() => setShowDropdown(false)}
            class="fixed inset-0 z-0"
          />
          {/* Dropdown Content */}
          <div class="absolute top-8 left-0 z-10 bg-menu border border-edge rounded-md shadow-md">
            {/* Admin Option */}
            <button
              class={`block w-full px-4 py-2 text-left hover:bg-hover hover-transition-bg ${
                props.is_it_admin ? 'bg-active' : ''
              }`}
              disabled={props.is_it_admin}
              onClick={patchUserAdmin}
            >
              <span class="font-semibold text-sm">Admin</span>
              <p class="text-[10px] leading-[12px] mt-1 max-w-xs">
                Can change organization settings and invite new members to the
                organization.
              </p>
            </button>

            <button
              class={`block w-full px-4 py-2 text-left hover:bg-hover hover-transition-bg ${
                !props.is_it_admin ? 'bg-active' : ''
              }`}
              disabled={!props.is_it_admin}
              onClick={patchUserMember}
            >
              <span class="font-semibold text-sm">Member</span>
              <p class="text-[10px] leading-[12px] mt-1 max-w-xs">
                Cannot change organization settings or invite new members to the
                organization.
              </p>
            </button>
          </div>
        </Show>
      </td>

      {/* Actions Cell */}
      <td class="px-6 text-right" colSpan={1}>
        <Show when={!props.is_it_admin}>
          <DeleteModal email={props.email} onDelete={handleDelete} />
        </Show>
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
      class={`px-1 py-1 min-w-9 text-sm font-normal text-ink-muted border border-edge rounded hover:bg-hover hover:border-ink-extra-muted transition-none hover:transition ease-in ${
        local.active ? 'bg-active' : ''
      }`}
      {...others}
    />
  );
};

const ActiveTable = () => {
  const {
    orgActiveStore,
    userPageSlice,
    deleteUser,
    patchUserRole,
    showingText,
    changePageIdx,
    pageIdxs,
  } = useActiveTable();
  const hasNext = createMemo(
    () =>
      orgActiveStore.pageIdx <
      Math.ceil(orgActiveStore.users.length / orgActiveStore.pageSize) - 1
  );
  const hasPrev = createMemo(() => orgActiveStore.pageIdx > 0);

  return (
    <div class="relative">
      <table class="table-fixed w-full h-72 text-sm text-left rtl:text-right text-ink-muted">
        <thead class="text-xs text-ink bg-edge/15">
          <tr>
            <th scope="col" colSpan={3} class="px-2 py-1 border-r border-edge">
              Email
            </th>
            <th scope="col" colSpan={3} class="px-6 py-1">
              Role
            </th>
            <th scope="col" colSpan={1} class="px-6 py-1" />
          </tr>
        </thead>
        <tbody>
          <For each={userPageSlice().filter((u) => u !== null)}>
            {(user) => (
              <UserRow
                deleteUser={deleteUser}
                patchUserRole={patchUserRole}
                {...user}
              />
            )}
          </For>
        </tbody>
      </table>
      <div class="flex justify-between items-center px-2 py-2">
        <div class="text-xs text-ink-muted">
          Showing <b>{showingText()}</b> of <b>{orgActiveStore.users.length}</b>
        </div>
        <div class="flex space-x-1">
          <TableButton
            onClick={() => changePageIdx(orgActiveStore.pageIdx - 1)}
            disabled={!hasPrev}
          >
            Prev
          </TableButton>

          <For each={pageIdxs()}>
            {(idx) => (
              <TableButton
                onClick={() => changePageIdx(idx)}
                active={orgActiveStore.pageIdx === idx}
              >
                {idx + 1}
              </TableButton>
            )}
          </For>

          <TableButton
            onClick={() => changePageIdx(orgActiveStore.pageIdx + 1)}
            disabled={!hasNext}
          >
            Next
          </TableButton>
        </div>
      </div>
    </div>
  );
};

export default ActiveTable;
