import {
  channelStore,
  isChannelAdminOrOwnerMemo,
} from '@block-channel/signal/channel';
import {
  useAddParticipantsToChannel,
  useRemoveParticipantsFromChannel,
} from '@block-channel/signal/participants';
import { getDestinationFromOptions } from '@core/component/NewMessage';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { Tooltip } from '@core/component/Tooltip';
import {
  idToEmail,
  recipientEntityMapper,
  useOrganizationUsers,
  type WithCustomUserInput,
} from '@core/user';
import InvitedIcon from '@icon/regular/paper-plane-tilt.svg';
import UsersIcon from '@icon/regular/users.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import BracketLeft from '@macro-icons/macro-group-bracket-left.svg';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { useUserId } from '@service-gql/client';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { UserItem } from './UserItem';

export function ParticipantManager(props: { participantCount: number }) {
  const channel = channelStore.get;
  const channelType = () => channel?.channel?.channel_type ?? 'private';
  const users = useOrganizationUsers();
  const userId = useUserId();
  const [usersToInvite, setUsersToInvite] = createSignal<
    WithCustomUserInput<'user'>[]
  >([]);
  const canManageParticipants = () =>
    channelType() !== ChannelType.organization;
  const addParticipantsToChannel = useAddParticipantsToChannel();

  function handleAddParticipants() {
    const destination = getDestinationFromOptions(usersToInvite());
    const userIds = destination.users;
    addParticipantsToChannel(userIds);
    setUsersToInvite([]);
  }

  const editable = () =>
    (canManageParticipants() && isChannelAdminOrOwnerMemo()) ?? false;

  const title = () =>
    canManageParticipants() && isChannelAdminOrOwnerMemo()
      ? 'Manage Participants'
      : 'View Participants';

  const options = () =>
    users()
      ?.filter((user) => {
        return !channel?.participants.find(
          (participant) => participant.user_id === user.id
        );
      })
      .map(recipientEntityMapper('user')) ?? [];

  return (
    <Dialog>
      <Dialog.Trigger>
        <Tooltip tooltip={title()}>
          <div
            class="flex items-center gap-1 py-1 font-mono text-xs text-ink-disabled hover:bg-hover relative"
            tabIndex={0}
            role="button"
          >
            <BracketLeft class="h-4 w-2 text-edge" />
            <UsersIcon class="size-4 text-ink" />
            <span class="text-xs">{props.participantCount.toString()}</span>
            <BracketLeft class="h-4 w-2 rotate-180 text-edge" />
          </div>
        </Tooltip>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay class="fixed flex inset-0 z-modal bg-modal-overlay items-center justify-content" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center bg-transparent">
          <Dialog.Content class="w-[512px] bg-dialog rounded-lg border-edge border-1 shadow-lg">
            <div class="flex flex-row justify-between items-center p-4">
              <Dialog.Title class="font-medium text-2xl text-ink-muted">
                {title()}
              </Dialog.Title>
              <Dialog.CloseButton class="text-ink-muted hover:bg-hover hover-transition-bg rounded-md p-1">
                <XIcon class="w-5 h-5" />
              </Dialog.CloseButton>
            </div>
            <Show
              when={
                channelType() &&
                ['private'].includes(channelType()!) &&
                isChannelAdminOrOwnerMemo()
              }
            >
              <div class="flex flex-col justify-between items-start px-4 gap-2 py-1 pt-2 text-ink-muted">
                <h1 class="justify-start items-start text-ink-muted text-sm font-medium font-sans">
                  Invite Participants
                </h1>
                <RecipientSelector<'user'>
                  placeholder={'Add participant'}
                  options={options}
                  selectedOptions={usersToInvite}
                  setSelectedOptions={setUsersToInvite}
                />
                <div class="flex w-full flex-row justify-end items-center">
                  <TextButton
                    theme="accent"
                    disabled={usersToInvite().length === 0}
                    icon={InvitedIcon}
                    text="Add Users"
                    onClick={handleAddParticipants}
                  />
                </div>
              </div>
            </Show>

            <div class="flex flex-col">
              <h1 class="justify-start items-start px-4 text-ink-muted text-sm font-medium font-sans">
                Participants{' '}
                <span class="text-ink-muted font-regular">
                  ({channel?.participants.length})
                </span>
              </h1>
              <ParticipantList
                editable={editable()}
                participants={channel.participants}
                userId={userId()!}
              />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}

function EmptyParticipantList(props: { query: string }) {
  return (
    <div class="flex flex-col items-center justify-center gap-2 text-ink-muted h-[300px] w-full">
      <div class="max-w-full px-4">
        <p class="whitespace-normal break-words">
          No matches found for "
          <span class="font-semibold break-all">{props.query}</span>"
        </p>
      </div>
    </div>
  );
}

export function ParticipantList(props: {
  participants: ChannelParticipant[];
  userId: string;
  editable: boolean;
}) {
  let ref!: HTMLDivElement;

  const [searchQuery, setSearchQuery] = createSignal('');
  const removeParticipants = useRemoveParticipantsFromChannel();

  const filteredParticipants = createMemo(() => {
    if (searchQuery().trim().length === 0) return props.participants;
    return props.participants.filter((p) => {
      return (
        p.user_id.toLowerCase().includes(searchQuery().toLowerCase()) ||
        idToEmail(p.user_id).toLowerCase().includes(searchQuery().toLowerCase())
      );
    });
  });

  return (
    <div ref={ref} class="flex flex-col px-4 py-2 w-full">
      <Show when={props.participants.length > 10}>
        <input
          placeholder="Search participants..."
          class="w-full rounded-md border-edge border-solid border p-2 text-sm text-ink-muted"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </Show>
      <div class="flex flex-col gap-3 max-h-[300px] w-full overflow-y-auto mt-1 overflow-x-hidden">
        <Show
          when={filteredParticipants().length > 0}
          fallback={<EmptyParticipantList query={searchQuery()} />}
        >
          <VList
            data={filteredParticipants()}
            style={{
              height: '300px',
              width: '100%',
            }}
            overscan={10}
          >
            {(participant) => (
              <UserItem
                mountPoint={ref}
                id={participant.user_id}
                description={participant.role}
                currentUserId={props.userId}
                removeParticipant={() =>
                  removeParticipants([participant.user_id])
                }
                editable={props.editable}
              />
            )}
          </VList>
        </Show>
      </div>
    </div>
  );
}
