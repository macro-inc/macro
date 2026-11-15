import { useSplitLayout } from '@components/app/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { recipientEntityMapper, type WithCustomUserInput } from '@core/user';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import HashIcon from '@icon/system/regular/hash.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import XIcon from '@icon/system/regular/x.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import { useAddBotToChannelMutation } from '@queries/channel/channel-bots';
import {
  useCreateChannelMutation,
  usePatchChannelMutation,
} from '@queries/channel/channels';
import { useAddParticipantsMutation } from '@queries/channel/participants';
import { useContactRecipientSource } from '@queries/contacts/recipient-source';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  Button,
  Dialog,
  InputGroup,
  Panel,
  RadioGroup,
  ToggleSwitch,
} from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import {
  chooseChannelPicture,
  useChannelPictureEditor,
} from './channel-picture';
import { ChannelPicture } from './components/ChannelPicture';

const [newChannelModalOpen, setNewChannelModalOpen] = createSignal(false);
const newChannelModalFocusLock = useFocusLock('create-channel');

type ChannelVisibility = 'team' | 'private';
type ChannelCreationStep = 'name' | 'visibility' | 'invite';

export function openNewChannelModal() {
  newChannelModalFocusLock.acquire();
  setNewChannelModalOpen(true);
}

export function CreateChannelModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  const userId = useUserId();
  const [step, setStep] = createSignal<ChannelCreationStep>('name');
  const agentsQuery = useAgentsQuery(
    () => newChannelModalOpen() && step() === 'invite'
  );
  const createChannelMutation = useCreateChannelMutation();
  const patchChannelMutation = usePatchChannelMutation();
  const addParticipantsMutation = useAddParticipantsMutation();
  const addAgentMutation = useAddBotToChannelMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const [name, setName] = createSignal('');
  const [visibility, setVisibility] = createSignal<ChannelVisibility>('team');
  const [autoJoinTeam, setAutoJoinTeam] = createSignal(true);
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'agent'>[]
  >([]);
  const [error, setError] = createSignal<string>();
  const [createdChannelId, setCreatedChannelId] = createSignal<string>();
  const [sentRecipientIds, setSentRecipientIds] = createSignal<string[]>([]);
  const [addedAgentIds, setAddedAgentIds] = createSignal<string[]>([]);
  const pictureEditor = useChannelPictureEditor();
  // The channel exists only after step 2, so the chosen file waits here.
  const [picture, setPicture] = createSignal<File>();
  const pictureUrl = createMemo(() => {
    const file = picture();
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    onCleanup(() => URL.revokeObjectURL(url));
    return url;
  });
  const channelName = createMemo(() => name().trim());
  const inviteOptions = createMemo(() => [
    ...(agentsQuery.isSuccess ? agentsQuery.data : []).map((agent) =>
      recipientEntityMapper('agent')(agent.bot)
    ),
  ]);
  const team = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team : undefined;
  let nameInput: HTMLInputElement | undefined;
  let visibilityOptions: HTMLDivElement | undefined;

  function reset() {
    setStep('name');
    setName('');
    setVisibility('team');
    setAutoJoinTeam(true);
    setSelectedRecipients([]);
    setError(undefined);
    setCreatedChannelId(undefined);
    setSentRecipientIds([]);
    setAddedAgentIds([]);
    setPicture(undefined);
  }

  function resetAndClose() {
    newChannelModalFocusLock.release();
    reset();
    setNewChannelModalOpen(false);
  }

  function close() {
    if (
      createChannelMutation.isPending ||
      patchChannelMutation.isPending ||
      addParticipantsMutation.isPending ||
      addAgentMutation.isPending
    )
      return;
    if (step() === 'invite' && visibility() === 'team') {
      fireAndForget(finishInvites(false), 'create-channel');
      return;
    }
    resetAndClose();
  }

  function goBack() {
    if (
      createChannelMutation.isPending ||
      patchChannelMutation.isPending ||
      addParticipantsMutation.isPending ||
      addAgentMutation.isPending
    )
      return;
    setError(undefined);
    setStep('name');
    queueMicrotask(() => nameInput?.focus());
  }

  async function createChannel() {
    if (createChannelMutation.isPending) return;
    const selectedVisibility = visibility();
    const selectedTeam = team();
    if (selectedVisibility === 'team' && !selectedTeam) {
      setError('Your team is still loading. Try again in a moment.');
      return;
    }

    // Team channels require a participant in the request; the API filters out
    // the owner after validating the list.
    const participants =
      selectedVisibility === 'team' && userId() ? [userId()!] : [];

    // The picture write has no account fence of its own: skip it if another
    // account signed in while the channel was being created.
    const account = currentQueryAccount();
    try {
      const { id } = await createChannelMutation.mutateAsync({
        channel_type: selectedVisibility,
        name: channelName(),
        participants,
        team_id: selectedVisibility === 'team' ? selectedTeam?.id : undefined,
        // Apply the invite-page switch after creation so turning it off never
        // leaves the current team pre-added to the channel.
        auto_join_team: false,
      });
      setCreatedChannelId(id);
      const chosenPicture = picture();
      if (chosenPicture && isCurrentQueryAccount(account))
        fireAndForget(
          pictureEditor.upload(id, chosenPicture),
          'create-channel'
        );
      setStep('invite');
      replaceOrInsertSplit({ type: 'channel', id });
    } catch (cause) {
      console.error('Failed to create channel', cause);
      setError('Failed to create channel. Try again.');
      toast.failure('Failed to create channel');
    }
  }

  async function finishInvites(includeRecipients = true) {
    const channelId = createdChannelId();
    if (
      !channelId ||
      patchChannelMutation.isPending ||
      addParticipantsMutation.isPending ||
      addAgentMutation.isPending
    )
      return;
    const sent = new Set(sentRecipientIds());
    const addedAgents = new Set(addedAgentIds());
    const participants = includeRecipients
      ? getDestinationFromOptions(selectedRecipients()).users.filter(
          (id) => !sent.has(id)
        )
      : [];
    const agents = includeRecipients
      ? selectedRecipients()
          .filter((option) => option.kind === 'agent')
          .filter((option) => !addedAgents.has(option.id))
      : [];

    try {
      setError(undefined);
      if (participants.length > 0) {
        await addParticipantsMutation.mutateAsync({ channelId, participants });
        setSentRecipientIds((previous) => [...previous, ...participants]);
      }
      for (const agent of agents) {
        await addAgentMutation.mutateAsync({ channelId, botId: agent.id });
        setAddedAgentIds((previous) => [...previous, agent.id]);
      }
      if (visibility() === 'team' && autoJoinTeam()) {
        await patchChannelMutation.mutateAsync({
          channelId,
          auto_join_team: true,
        });
      }
      resetAndClose();
    } catch (cause) {
      console.error('Failed to finish channel invitations', cause);
      setError('Failed to finish setting up this channel. Try again.');
    }
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (
      createChannelMutation.isPending ||
      patchChannelMutation.isPending ||
      addParticipantsMutation.isPending ||
      addAgentMutation.isPending
    )
      return;
    setError(undefined);

    if (step() === 'name') {
      if (!channelName()) {
        setError('Enter a channel name');
        return;
      }
      setStep('visibility');
      queueMicrotask(() =>
        visibilityOptions
          ?.querySelector<HTMLInputElement>('input:checked')
          ?.focus()
      );
      return;
    }

    if (step() === 'visibility') {
      fireAndForget(createChannel(), 'create-channel');
      return;
    }

    // The invite action is a button so Enter remains available to the combobox.
  }

  return (
    <Dialog
      open={newChannelModalOpen()}
      onOpenChange={(open) => !open && close()}
      class="w-150"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[85vh]">
        <Panel.Body scroll>
          <form class="flex flex-col gap-7 p-6 sm:p-8" onSubmit={handleSubmit}>
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <Dialog.Title class="text-xl font-semibold text-ink">
                  {step() === 'invite' ? (
                    <>
                      Add people or agents to{' '}
                      <span class="inline-flex items-center gap-1.5 align-bottom">
                        <ChannelMark
                          pictureUrl={pictureUrl()}
                          private={visibility() === 'private'}
                          class="size-5"
                        />
                        {channelName()}
                      </span>
                    </>
                  ) : (
                    'Create a channel'
                  )}
                </Dialog.Title>
                <Show when={step() === 'visibility'}>
                  <p class="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                    <ChannelMark
                      pictureUrl={pictureUrl()}
                      private={visibility() === 'private'}
                      class="size-4"
                    />
                    {channelName()}
                  </p>
                </Show>
              </div>
              <Dialog.CloseButton
                aria-label="Close"
                tooltip="Close"
                as={Button}
                variant="ghost"
                size="icon-sm"
                tabIndex={-1}
                disabled={
                  createChannelMutation.isPending ||
                  patchChannelMutation.isPending ||
                  addParticipantsMutation.isPending ||
                  addAgentMutation.isPending
                }
              >
                <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
              </Dialog.CloseButton>
            </div>

            <Show when={step() === 'name'}>
              <div class="flex flex-col gap-6">
                <div class="flex flex-col gap-2">
                  <label
                    for="new-channel-name"
                    class="text-sm font-medium text-ink"
                  >
                    Name
                  </label>
                  <InputGroup
                    size="xl"
                    class="focus-within:ring-2 focus-within:ring-edge-muted"
                  >
                    <InputGroup.Addon>
                      <HashIcon aria-hidden="true" class="size-4" />
                    </InputGroup.Addon>
                    <InputGroup.Input
                      ref={nameInput}
                      id="new-channel-name"
                      type="text"
                      value={name()}
                      onInput={(event) => {
                        setName(event.currentTarget.value);
                        setError(undefined);
                      }}
                      placeholder="e.g. Feature Requests"
                      maxLength={80}
                      autocomplete="off"
                      data-1p-ignore
                      aria-invalid={error() === 'Enter a channel name'}
                      aria-describedby="new-channel-name-description"
                    />
                    <InputGroup.Addon align="inline-end">
                      <span class="text-xs tabular-nums text-ink-extra-muted">
                        {80 - name().length}
                      </span>
                    </InputGroup.Addon>
                  </InputGroup>
                  <p
                    id="new-channel-name-description"
                    class="text-sm text-ink-muted"
                  >
                    Channels are where conversations happen around a topic. Use
                    a name that is easy to find and understand.
                  </p>
                </div>
                <ChannelPictureField
                  pictureUrl={pictureUrl()}
                  onChoose={() => chooseChannelPicture(setPicture)}
                  onRemove={() => setPicture(undefined)}
                />
              </div>
            </Show>

            <Show when={step() === 'visibility'}>
              <div ref={visibilityOptions} class="flex flex-col gap-3">
                <span class="text-sm font-medium text-ink">Visibility</span>
                <RadioGroup
                  variant="cards"
                  value={visibility()}
                  onChange={(value) => {
                    if (value !== 'team' && value !== 'private') return;
                    setVisibility(value);
                    setError(undefined);
                  }}
                  aria-label="Visibility"
                  class="grid-cols-1 sm:grid-cols-2"
                >
                  <RadioGroup.Item value="team">
                    <HashIcon
                      aria-hidden="true"
                      class="mt-0.5 size-4 shrink-0"
                    />
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                        Team
                      </RadioGroup.ItemLabel>
                      <RadioGroup.ItemDescription class="text-xs text-ink-muted">
                        Anyone on your team can find and join it
                      </RadioGroup.ItemDescription>
                    </div>
                    <RadioGroup.ItemControl class="mt-0.5" />
                  </RadioGroup.Item>
                  <RadioGroup.Item value="private">
                    <LockIcon
                      aria-hidden="true"
                      class="mt-0.5 size-4 shrink-0"
                    />
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                        Private
                      </RadioGroup.ItemLabel>
                      <RadioGroup.ItemDescription class="text-xs text-ink-muted">
                        Only people you invite can view or join it
                      </RadioGroup.ItemDescription>
                    </div>
                    <RadioGroup.ItemControl class="mt-0.5" />
                  </RadioGroup.Item>
                </RadioGroup>
              </div>
            </Show>

            <Show when={step() === 'invite'}>
              <div class="flex flex-col gap-3">
                <RecipientSelector<'user' | 'contact' | 'agent'>
                  options={inviteOptions}
                  createSource={useContactRecipientSource}
                  selectedOptions={selectedRecipients()}
                  setSelectedOptions={setSelectedRecipients}
                  placeholder="Search people, agents, or email addresses"
                  focusOnMount
                  inviteExternalEmails
                  class="min-h-12 rounded-full border-edge-frame bg-control px-3 py-2 focus-within:ring-2 focus-within:ring-edge-muted"
                />
                <Show when={visibility() === 'team'}>
                  <ToggleSwitch
                    size="md"
                    class="w-full gap-3 py-2"
                    controlClass="shrink-0"
                    checked={autoJoinTeam()}
                    disabled={
                      patchChannelMutation.isPending ||
                      addParticipantsMutation.isPending ||
                      addAgentMutation.isPending
                    }
                    onChange={setAutoJoinTeam}
                    label={
                      <span class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-sm font-medium text-ink">
                          Automatically add teammates
                        </span>
                        <span class="text-xs text-ink-muted">
                          Add current and future teammates to this channel.
                        </span>
                      </span>
                    }
                  />
                </Show>
              </div>
            </Show>

            <Show when={error()}>
              {(message) => (
                <p class="text-sm text-failure-ink" role="alert">
                  {message()}
                </p>
              )}
            </Show>

            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-ink-muted">
                Step{' '}
                {step() === 'name' ? '1' : step() === 'visibility' ? '2' : '3'}{' '}
                of 3
              </span>
              <div class="flex items-center gap-2">
                <Show when={step() === 'visibility'}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={createChannelMutation.isPending}
                    onClick={goBack}
                  >
                    Back
                  </Button>
                </Show>
                <Button
                  type={step() === 'invite' ? 'button' : 'submit'}
                  onClick={() => {
                    if (step() === 'invite')
                      fireAndForget(finishInvites(), 'create-channel');
                  }}
                  variant="primary"
                  disabled={
                    (step() !== 'invite' && !channelName()) ||
                    createChannelMutation.isPending ||
                    patchChannelMutation.isPending ||
                    addParticipantsMutation.isPending ||
                    addAgentMutation.isPending ||
                    (step() === 'visibility' &&
                      visibility() === 'team' &&
                      !team())
                  }
                >
                  {step() === 'name'
                    ? 'Next'
                    : step() === 'visibility'
                      ? createChannelMutation.isPending
                        ? 'Creating…'
                        : 'Create'
                      : patchChannelMutation.isPending ||
                          addParticipantsMutation.isPending ||
                          addAgentMutation.isPending
                        ? 'Saving…'
                        : selectedRecipients().length > 0
                          ? 'Add'
                          : 'Skip for now'}
                </Button>
              </div>
            </div>
          </form>
        </Panel.Body>
        <Show when={step() === 'invite'}>
          <Panel.Footer class="items-start gap-3 px-6 py-4 sm:px-8">
            <InfoIcon
              aria-hidden="true"
              class="mt-0.5 size-5 shrink-0 text-accent"
            />
            <p class="text-sm text-ink-muted">
              <Show
                when={visibility() === 'team'}
                fallback={
                  <>
                    <strong class="font-semibold text-ink">
                      Working with people outside your team?
                    </strong>{' '}
                    Type their email above and press Enter. If they don’t have a
                    Macro account, clicking Add emails them an invite.
                  </>
                }
              >
                <strong class="font-semibold text-ink">
                  Team channels are always discoverable.
                </strong>{' '}
                Anyone on your team can find and join this channel, even when
                automatic adding is off.
              </Show>
            </p>
          </Panel.Footer>
        </Show>
      </Panel>
    </Dialog>
  );
}

/** The new channel's picture, or its visibility icon until one is chosen. */
function ChannelMark(props: {
  pictureUrl?: string;
  private: boolean;
  class: string;
}) {
  return (
    <ChannelPicture
      url={props.pictureUrl}
      class={props.class}
      fallback={
        <Show
          when={props.private}
          fallback={<HashIcon aria-hidden="true" class="m-auto size-[80%]" />}
        >
          <LockIcon aria-hidden="true" class="m-auto size-[80%]" />
        </Show>
      }
    />
  );
}

function ChannelPictureField(props: {
  pictureUrl?: string;
  onChoose: () => void;
  onRemove: () => void;
}) {
  let chooseButton: HTMLButtonElement | undefined;
  return (
    <div class="flex items-center gap-3">
      {/* A second, pointer-only target; the labelled buttons stay the tab stops. */}
      <Button
        type="button"
        appearance="bare"
        size="icon-xl"
        tabIndex={-1}
        aria-label={
          props.pictureUrl ? 'Change channel picture' : 'Add a channel picture'
        }
        onClick={() => props.onChoose()}
      >
        <ChannelPicture
          url={props.pictureUrl}
          class="size-12"
          fallback={
            <span class="flex size-full items-center justify-center rounded-lg border border-dashed border-edge text-ink-muted">
              <ImageIcon aria-hidden="true" class="size-5" />
            </span>
          }
        />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-ink">Channel picture</div>
        <div class="mt-0.5 text-xs text-ink-muted">
          Helps people spot the channel at a glance. Square images work best.
        </div>
      </div>
      {/* The choose button stays mounted as its label changes, so it keeps focus. */}
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.pictureUrl}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              chooseButton?.focus();
              props.onRemove();
            }}
          >
            Remove
          </Button>
        </Show>
        <Button
          ref={chooseButton}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => props.onChoose()}
        >
          <Show when={!props.pictureUrl}>
            <UploadIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
          </Show>
          {props.pictureUrl ? 'Change' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}
