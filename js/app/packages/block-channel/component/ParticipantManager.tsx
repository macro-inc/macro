import {
  useAddParticipantsToChannel,
  useRemoveParticipantsFromChannel,
} from '@block-channel/hooks/participants';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { getDestinationFromOptions } from '@core/component/NewMessage';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { Tooltip } from '@core/component/Tooltip';
import {
  idToEmail,
  recipientEntityMapper,
  useContacts,
  type WithCustomUserInput,
} from '@core/user';
import InvitedIcon from '@icon/regular/paper-plane-tilt.svg';
import UsersIcon from '@icon/regular/users.svg';
import CloseIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import BracketLeft from '@macro-icons/macro-group-bracket-left.svg';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { useUserId } from '@core/context/user';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { beveledCorners } from '../../block-theme/signals/themeSignals';
import { UserItem } from './UserItem';

type ParticipantManagerProps = {
  channelId: string;
  channelType?: string;
  participants: ChannelParticipant[];
  participantCount: number;
};

export function ParticipantManager(props: ParticipantManagerProps) {
  const channelType = () => props.channelType ?? 'private';
  const users = useContacts();
  const userId = useUserId();
  const [usersToInvite, setUsersToInvite] = createSignal<
    WithCustomUserInput<'user'>[]
  >([]);
  const canManageParticipants = () =>
    channelType() !== ChannelType.organization;
  const addParticipantsToChannel = useAddParticipantsToChannel(
    () => props.channelId
  );

  function handleAddParticipants() {
    const destination = getDestinationFromOptions(usersToInvite());
    const userIds = destination.users;
    addParticipantsToChannel(userIds);
    setUsersToInvite([]);
  }

  const editable = () => canManageParticipants();

  const title = () =>
    canManageParticipants() ? 'Manage Participants' : 'View Participants';

  const options = () =>
    users()
      ?.filter((user) => {
        return !props.participants.find(
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
        <Dialog.Overlay class="fixed inset-0 z-modal bg-transparent" />
        <DialogWrapper>
          <Dialog.Content>
            <ClippedPanel tl={!beveledCorners()} active>
              <div class="flex flex-row items-center px-2 h-[40px] gap-2 border-b-1 border-b-edge-muted">
                <Dialog.CloseButton>
                  <DeprecatedIconButton
                    tooltip={{ label: 'Close' }}
                    icon={CloseIcon}
                    iconSize={16}
                    theme="clear"
                    size="sm"
                  />
                </Dialog.CloseButton>
                <Dialog.Title class="text-sm">{title()}</Dialog.Title>
              </div>
              <Show
                when={
                  channelType() &&
                  ['private'].includes(channelType()!) &&
                  canManageParticipants()
                }
              >
                <div class="flex flex-row justify-between gap-2 min-h-[40px] text-ink-muted border-b border-edge-muted/50 p-2 items-center">
                  <RecipientSelector<'user'>
                    setSelectedOptions={setUsersToInvite}
                    selectedOptions={usersToInvite()}
                    placeholder={'Search'}
                    options={options}
                    hideBorder
                    noPadding
                  />
                  <DeprecatedTextButton
                    disabled={usersToInvite().length === 0}
                    onClick={handleAddParticipants}
                    icon={InvitedIcon}
                    text={
                      usersToInvite().length > 1
                        ? 'Add Participants'
                        : 'Add Participant'
                    }
                    theme="accent"
                  />
                </div>
              </Show>

              <div class="flex flex-col">
                <ParticipantList
                  channelId={props.channelId}
                  editable={editable()}
                  participants={props.participants}
                  userId={userId()!}
                />
              </div>
            </ClippedPanel>
          </Dialog.Content>
        </DialogWrapper>
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
  channelId: string;
  participants: ChannelParticipant[];
  userId: string;
  editable: boolean;
}) {
  let ref!: HTMLDivElement;

  const [searchQuery, setSearchQuery] = createSignal('');
  const removeParticipants = useRemoveParticipantsFromChannel(
    () => props.channelId
  );

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
    <div ref={ref} class="flex flex-col w-full">
      <Show when={props.participants.length > 10}>
        <input
          placeholder="Search"
          class="w-full border-edge-muted/50 border-b-1 px-2 h-[40px] text-sm text-ink-muted"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </Show>
      <div class="flex flex-col gap-3 max-h-[300px] w-full overflow-y-auto overflow-x-hidden">
        <Show
          when={filteredParticipants().length > 0}
          fallback={<EmptyParticipantList query={searchQuery()} />}
        >
          <VList
            data={filteredParticipants()}
            style={{
              'scrollbar-width': 'none',
              height: '300px',
              width: '100%',
            }}
            bufferSize={500}
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
