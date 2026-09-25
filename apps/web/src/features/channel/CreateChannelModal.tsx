import { useSplitLayout } from '@components/app/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { recipientEntityMapper, type WithCustomUserInput } from '@core/user';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { getDestinationFromOptions } from '@core/util/destination';
import HashIcon from '@phosphor/hash.svg';
import InfoIcon from '@phosphor/info.svg';
import LockIcon from '@phosphor/lock.svg';
import XIcon from '@phosphor/x.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import { useAddBotToChannelMutation } from '@queries/channel/channel-bots';
import {
  useCreateChannelMutation,
  usePatchChannelMutation,
} from '@queries/channel/channels';
import { useAddParticipantsMutation } from '@queries/channel/participants';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  Button,
  Dialog,
  InputGroup,
  Panel,
  RadioGroup,
  ToggleSwitch,
} from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

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
  const { users: recipientOptions } = useCombinedRecipients();
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
  const channelName = createMemo(() => name().trim());
  const inviteOptions = createMemo(() => [
    ...recipientOptions(),
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
      void finishInvites(false);
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
      void createChannel();
      return;
    }

    // The invite action is a button so Enter remains available to the combobox.
  }

  return (
    <Dialog
      open={newChannelModalOpen()}
      onOpenChange={(open) => !open && close()}
      position="center"
      class="w-150"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[85vh]">
        <Panel.Body scroll>
          <form
            class="flex min-h-80 flex-col gap-7 p-6 sm:p-8"
            onSubmit={handleSubmit}
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <Dialog.Title class="text-xl font-semibold text-ink">
                  {step() === 'invite' ? (
                    <>
                      Add people or agents to{' '}
                      <span class="inline-flex items-baseline gap-1">
                        <Show
                          when={visibility() === 'private'}
                          fallback={
                            <HashIcon
                              aria-hidden="true"
                              class="inline size-4"
                            />
                          }
                        >
                          <LockIcon aria-hidden="true" class="inline size-4" />
                        </Show>
                        {channelName()}
                      </span>
                    </>
                  ) : (
                    'Create a channel'
                  )}
                </Dialog.Title>
                <Show when={step() === 'visibility'}>
                  <p class="mt-1 flex items-center gap-1 text-sm text-ink-muted">
                    <Show
                      when={visibility() === 'private'}
                      fallback={
                        <HashIcon aria-hidden="true" class="size-3.5" />
                      }
                    >
                      <LockIcon aria-hidden="true" class="size-3.5" />
                    </Show>
                    {channelName()}
                  </p>
                </Show>
              </div>
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                label="Close"
                tabIndex={-1}
                disabled={
                  createChannelMutation.isPending ||
                  patchChannelMutation.isPending ||
                  addParticipantsMutation.isPending ||
                  addAgentMutation.isPending
                }
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>

            <Show when={step() === 'name'}>
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
                  Channels are where conversations happen around a topic. Use a
                  name that is easy to find and understand.
                </p>
              </div>
            </Show>

            <Show when={step() === 'visibility'}>
              <div ref={visibilityOptions} class="flex flex-col gap-3">
                <span class="text-sm font-medium text-ink">Visibility</span>
                <RadioGroup
                  value={visibility()}
                  onChange={(value) => {
                    if (value !== 'team' && value !== 'private') return;
                    setVisibility(value);
                    setError(undefined);
                  }}
                  aria-label="Visibility"
                  class="gap-4"
                >
                  <RadioGroup.Item value="team" class="items-start">
                    <RadioGroup.ItemControl class="mt-0.5" />
                    <div class="flex flex-col gap-1">
                      <RadioGroup.ItemLabel class="text-base text-ink">
                        Team — anyone on your team
                      </RadioGroup.ItemLabel>
                      <RadioGroup.ItemDescription class="text-sm text-ink-muted">
                        Always discoverable to teammates
                      </RadioGroup.ItemDescription>
                    </div>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="private" class="items-start">
                    <RadioGroup.ItemControl class="mt-0.5" />
                    <div class="flex flex-col gap-1">
                      <RadioGroup.ItemLabel class="text-base text-ink">
                        Private — only specific people
                      </RadioGroup.ItemLabel>
                      <RadioGroup.ItemDescription class="text-sm text-ink-muted">
                        Can only be viewed or joined by invitation
                      </RadioGroup.ItemDescription>
                    </div>
                  </RadioGroup.Item>
                </RadioGroup>
              </div>
            </Show>

            <Show when={step() === 'invite'}>
              <div class="flex flex-col gap-3">
                <RecipientSelector<'user' | 'contact' | 'agent'>
                  options={inviteOptions}
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

            <div class="mt-auto flex items-center justify-between gap-3 pt-4">
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
                    if (step() === 'invite') void finishInvites();
                  }}
                  variant={
                    step() === 'invite' && selectedRecipients().length === 0
                      ? 'ghost'
                      : 'accent'
                  }
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
