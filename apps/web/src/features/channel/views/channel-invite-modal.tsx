import { RecipientSelector } from '@core/component/RecipientSelector';
import { getDestinationFromOptions } from '@core/util/destination';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel, RadioGroup } from '@ui';
import { type ComponentProps, createSignal, Show } from 'solid-js';
import { createChannelInvites } from '../primitives/create-channel-invites';

export type ChannelInviteTeam = {
  name: string;
  memberIds: string[];
};

type PeoplePickerProps = ComponentProps<
  typeof RecipientSelector<'user' | 'contact'>
>;

export function ChannelInviteModal(props: {
  channelName: string;
  team?: ChannelInviteTeam;
  teamLoading: boolean;
  teamError: boolean;
  participantsReady: boolean;
  participantIds: string[];
  options: PeoplePickerProps['options'];
  onAdd: (participantIds: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [mode, setMode] = createSignal<'team' | 'specific'>('specific');
  const [selected, setSelected] = createSignal<
    PeoplePickerProps['selectedOptions']
  >([]);
  const {
    pending,
    error,
    clearError,
    participantIds,
    canAdd,
    close,
    addPeople,
  } = createChannelInvites({
    candidateIds: () =>
      mode() === 'team'
        ? (props.team?.memberIds ?? [])
        : getDestinationFromOptions(selected()).users,
    existingIds: () => props.participantIds,
    ready: () => props.participantsReady,
    add: props.onAdd,
    onClose: props.onClose,
  });
  const options = () => {
    const existing = new Set(props.participantIds);
    return props.options().filter((option) => !existing.has(option.id));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()} class="w-140">
      <Panel depth={2} class="rounded-xl *:max-h-[85vh]">
        <Panel.Body scroll>
          <div class="flex flex-col gap-6 p-6">
            <div class="flex items-start justify-between gap-4">
              <Dialog.Title class="min-w-0 break-words text-xl font-semibold text-ink">
                Invite people to {props.channelName}
              </Dialog.Title>
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                label="Close"
                tabIndex={-1}
                disabled={pending()}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>
            <RadioGroup
              value={mode()}
              onChange={(value) => {
                if (value !== 'team' && value !== 'specific') return;
                setMode(value);
                clearError();
              }}
              disabled={pending()}
              aria-label="People to invite"
              class="gap-4"
            >
              <RadioGroup.Item
                value="team"
                disabled={!props.team}
                class="items-start"
              >
                <RadioGroup.ItemControl class="mt-0.5" />
                <div class="flex min-w-0 flex-col gap-1">
                  <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                    Add all members of {props.team?.name ?? 'your team'}
                  </RadioGroup.ItemLabel>
                  <RadioGroup.ItemDescription class="text-sm text-ink-muted">
                    {props.teamLoading
                      ? 'Loading your team…'
                      : props.teamError
                        ? 'Could not load your team. Reopen this dialog to try again.'
                        : !props.team
                          ? 'You need to belong to a team to use this option.'
                          : 'Add current teammates who are not already in this channel.'}
                  </RadioGroup.ItemDescription>
                </div>
              </RadioGroup.Item>
              <RadioGroup.Item value="specific">
                <RadioGroup.ItemControl />
                <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                  Add specific people
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            </RadioGroup>
            <Show when={mode() === 'specific'}>
              <div class="flex flex-col gap-3">
                <RecipientSelector<'user' | 'contact'>
                  options={options}
                  selectedOptions={selected()}
                  setSelectedOptions={setSelected}
                  placeholder="Search people or email addresses"
                  disabled={pending()}
                  inviteExternalEmails
                  class="min-h-12 rounded-full border-edge-frame bg-control px-3 py-2 focus-within:ring-2 focus-within:ring-edge-muted"
                />
                <p class="text-sm text-ink-muted">
                  Invite teammates or people outside your team by entering their
                  email address.
                </p>
              </div>
            </Show>
            <Show
              when={
                mode() === 'team' &&
                props.team &&
                props.participantsReady &&
                participantIds().length === 0
              }
            >
              <p class="text-sm text-ink-muted">
                All teammates are already in this channel.
              </p>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure-ink">
                {error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={pending()}>
                Cancel
              </Button>
              <Button
                variant="accent"
                onClick={() => void addPeople()}
                disabled={!canAdd()}
              >
                {pending() ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
