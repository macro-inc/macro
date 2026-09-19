import { useSplitLayout } from '@components/app/split-layout/layout';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  getDisplayName,
  tryMacroId,
  type WithCustomUserInput,
} from '@core/user';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { getDestinationFromOptions } from '@core/util/destination';
import HashIcon from '@phosphor/hash.svg';
import InfoIcon from '@phosphor/info.svg';
import XIcon from '@phosphor/x.svg';
import { useCreateChannelMutation } from '@queries/channel/channels';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { Button, Dialog, Panel, ToggleSwitch, Tooltip } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

const [newChannelModalOpen, setNewChannelModalOpen] = createSignal(false);
const newChannelModalFocusLock = useFocusLock('create-channel');

const CHANNEL_TYPE_TABS = [
  { value: 'private', label: 'Private' },
  { value: 'team', label: 'Team' },
];

type CreatableChannelType = 'private' | 'team';

function TeamMemberListItem(props: { member: TeamMember; isLast: boolean }) {
  const displayName = () => getDisplayName(tryMacroId(props.member.user_id));

  return (
    <div
      class="flex items-center gap-2 bg-surface px-3 py-1.5"
      classList={{ 'border-b border-edge-muted': !props.isLast }}
    >
      <UserIcon
        id={props.member.user_id}
        size="md"
        showTooltip={false}
        suppressClick
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-ink">{displayName()}</div>
        <div class="text-xs capitalize text-ink-muted">{props.member.role}</div>
      </div>
    </div>
  );
}

export function openNewChannelModal() {
  newChannelModalFocusLock.acquire();
  setNewChannelModalOpen(true);
}

export function CreateChannelModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  const userId = useUserId();
  const { users: recipientOptions } = useCombinedRecipients();
  const createChannelMutation = useCreateChannelMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const [name, setName] = createSignal('');
  const [teamListScrollRef, setTeamListScrollRef] =
    createSignal<HTMLDivElement>();
  const [channelType, setChannelType] =
    createSignal<CreatableChannelType>('private');
  const [autoJoinTeam, setAutoJoinTeam] = createSignal(false);
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);
  const [error, setError] = createSignal<string>();
  const channelName = createMemo(() => name().trim());
  const team = createMemo(() => currentTeamQuery.data?.team);
  const teamMembers = createMemo(() => currentTeamQuery.data?.members ?? []);
  const canSubmit = createMemo(
    () => channelName().length > 0 && !createChannelMutation.isPending
  );

  function reset() {
    setName('');
    setChannelType('private');
    setAutoJoinTeam(false);
    setSelectedRecipients([]);
    setError(undefined);
  }

  function resetAndClose() {
    newChannelModalFocusLock.release();
    reset();
    setNewChannelModalOpen(false);
  }

  function close() {
    if (createChannelMutation.isPending) return;
    resetAndClose();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmedName = channelName();
    if (!trimmedName) {
      setError('Enter a channel name');
      return;
    }

    setError(undefined);
    const destination = getDestinationFromOptions(selectedRecipients());
    const selectedChannelType = channelType();
    const isTeamChannel = selectedChannelType === 'team';
    const selectedTeam = team();
    if (isTeamChannel && !selectedTeam) {
      setError('Select a team to create a team channel');
      return;
    }

    // Team channels currently require a non-empty participant list. The
    // repository filters out the owner after satisfying that validation.
    const participants =
      isTeamChannel && destination.users.length === 0 && userId()
        ? [userId()!]
        : destination.users;

    try {
      const { id } = await createChannelMutation.mutateAsync({
        channel_type: selectedChannelType,
        name: trimmedName,
        participants,
        team_id: isTeamChannel ? selectedTeam?.id : undefined,
        auto_join_team: isTeamChannel && autoJoinTeam(),
      });
      resetAndClose();
      replaceOrInsertSplit({ type: 'channel', id });
    } catch (cause) {
      console.error('Failed to create channel', cause);
      setError('Failed to create channel. Try again.');
      toast.failure('Failed to create channel');
    }
  }

  return (
    <Dialog
      open={newChannelModalOpen()}
      onOpenChange={(open) => !open && close()}
    >
      <Panel depth={2} class="rounded-xl *:max-h-[75vh]">
        <Panel.Body>
          <form class="flex flex-col gap-4 p-4" onSubmit={handleSubmit}>
            <div class="flex items-center gap-1">
              <Show when={team()}>
                <TabsInset
                  depth={2}
                  list={CHANNEL_TYPE_TABS}
                  value={channelType()}
                  onChange={(value) => {
                    if (value !== 'private' && value !== 'team') return;
                    setChannelType(value);
                    setError(undefined);
                  }}
                />
              </Show>
              <div class="flex-1" />
              <Dialog.CloseButton
                as={Button}
                size="icon-sm"
                label="Close"
                tabIndex={-1}
                disabled={createChannelMutation.isPending}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>

            <div class="flex flex-col gap-4">
              <div class="flex items-center gap-2 px-2">
                <Dialog.Title class="sr-only">Create a channel</Dialog.Title>
                <label for="new-channel-name" class="sr-only">
                  Name
                </label>
                <HashIcon
                  aria-hidden="true"
                  class="size-5 shrink-0 text-ink-placeholder"
                />
                <input
                  id="new-channel-name"
                  type="text"
                  value={name()}
                  onInput={(event) => {
                    setName(event.currentTarget.value);
                    setError(undefined);
                  }}
                  placeholder="Channel name"
                  autocomplete="off"
                  data-1p-ignore
                  aria-invalid={error() === 'Enter a channel name'}
                  class="h-10 w-full border-none bg-transparent px-0 text-xl font-medium text-ink outline-none placeholder:text-ink-placeholder focus:ring-0"
                />
              </div>

              <div class="flex flex-col gap-2 px-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-ink-muted">
                    Invite people
                  </span>
                  <span class="rounded-full bg-ink/5 px-1.5 py-0.5 text-xxs font-medium text-ink-extra-muted">
                    Optional
                  </span>
                </div>
                <RecipientSelector<'user' | 'contact'>
                  options={recipientOptions}
                  selectedOptions={selectedRecipients()}
                  setSelectedOptions={setSelectedRecipients}
                  placeholder="To: Macro users or email addresses"
                />
                <Show when={channelType() === 'team' && autoJoinTeam()}>
                  <div class="mt-2 flex flex-col gap-2">
                    <div class="flex items-center gap-1">
                      <span class="text-xs font-medium text-ink-muted">
                        Included team members
                      </span>
                      <span class="text-xs text-ink-extra-muted">
                        ({teamMembers().length})
                      </span>
                    </div>
                    <div class="relative max-h-56 rounded-lg border border-edge-muted">
                      <div
                        ref={setTeamListScrollRef}
                        class="scrollbar-hidden max-h-56 overflow-y-auto"
                      >
                        <For each={teamMembers()}>
                          {(member, index) => (
                            <TeamMemberListItem
                              member={member}
                              isLast={index() === teamMembers().length - 1}
                            />
                          )}
                        </For>
                      </div>
                      <CustomScrollbar
                        scrollContainer={teamListScrollRef}
                        watchContent
                      />
                    </div>
                  </div>
                </Show>
              </div>
            </div>

            <Show when={error()}>
              {(message) => (
                <div class="border-y border-edge-muted p-2">
                  <div class="px-3 py-2 text-sm text-failure-ink" role="alert">
                    {message()}
                  </div>
                </div>
              )}
            </Show>

            <div class="flex shrink-0 items-center justify-end gap-3 px-2">
              <Show when={channelType() === 'private'}>
                <p class="mr-auto text-xs text-ink-extra-muted">
                  Only people you invite can see this channel.
                </p>
              </Show>
              <Show when={channelType() === 'team' && team()}>
                <div class="mr-auto flex items-center gap-1.5">
                  <ToggleSwitch
                    labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
                    onChange={setAutoJoinTeam}
                    checked={autoJoinTeam()}
                    label="Team Auto-Join"
                  />
                  <Tooltip
                    as="span"
                    placement="bottom"
                    label={
                      autoJoinTeam()
                        ? 'Current and new team members will join automatically.'
                        : 'Team members can choose whether to join this channel.'
                    }
                  >
                    <InfoIcon class="size-3.5 text-ink-extra-muted" />
                  </Tooltip>
                </div>
              </Show>
              <Button
                type="submit"
                variant={canSubmit() ? 'accent' : 'ghost'}
                depth={3}
                class="rounded-lg border-0"
                disabled={!canSubmit()}
              >
                {createChannelMutation.isPending
                  ? 'Creating…'
                  : 'Create Channel'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
