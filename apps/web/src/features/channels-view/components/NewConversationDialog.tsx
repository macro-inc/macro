import { useAgentDmRecipients } from '@app/features/agent-dms/agent-dm-recipients';
import { selectConversationRecipients } from '@app/features/agent-dms/core/personas';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { UserIcon } from '@core/component/UserIcon';
import {
  ENABLE_AGENT_DMS,
  enableChatSidebarSections,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type CombinedRecipientItem,
  emailToMacroId,
  recipientEntityMapper,
  type WithCustomUserInput,
} from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFreshSearch } from '@core/util/freshSort';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Telemetry } from '@macro-inc/observability';
import { useAgentsQuery } from '@queries/agents/agents';
import { useAddBotToChannelMutation } from '@queries/channel/channel-bots';
import {
  useCreateChannelMutation,
  usePatchChannelMutation,
} from '@queries/channel/channels';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { useAddParticipantsMutation } from '@queries/channel/participants';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  Button,
  Dialog,
  InputGroup,
  type ManagedDialogProps,
  openDialog,
  ToggleSwitch,
} from '@ui';
import * as EmailValidator from 'email-validator';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import {
  type ChannelSetupInput,
  type ChannelSetupProgress,
  completeChannelSetup,
} from '../core/channel-setup';

type ConversationRecipient = WithCustomUserInput<'user' | 'contact' | 'agent'>;
type ConversationOption =
  | ConversationRecipient
  | CombinedRecipientItem<'channel'>;

function optionName(option: ConversationOption): string {
  if (option.kind === 'custom') return option.data.email;
  return (
    option.data.name ||
    (option.kind === 'user' || option.kind === 'contact'
      ? option.data.email
      : '')
  );
}

const searchOptions = createFreshSearch<ConversationOption>({
  config: { rankNameMatchesFirst: true, useViewedAt: true },
  getName: (option) =>
    option.kind === 'user' || option.kind === 'contact'
      ? `${optionName(option)} ${option.data.email}`
      : optionName(option),
  getDisplayName: optionName,
  isChannelItem: (option) => option.kind === 'channel',
  getTimestamp: (option) => {
    if (option.kind === 'user')
      return { lastInteraction: option.data.lastInteraction };
    if (option.kind === 'channel')
      return {
        updatedAt: option.data.updated_at,
      };
    return {};
  },
});

function OptionIcon(props: { option: ConversationOption }) {
  return (
    <Show
      when={props.option.kind === 'channel'}
      fallback={
        <Show
          when={props.option.kind === 'agent'}
          fallback={<UserIcon id={props.option.id} size="sm" suppressClick />}
        >
          <RobotIcon class="size-4 shrink-0 text-ink-muted" />
        </Show>
      }
    >
      <Show
        when={
          props.option.kind === 'channel' &&
          props.option.data.channel_type === 'private'
        }
        fallback={<HashIcon class="size-4 shrink-0 text-ink-muted" />}
      >
        <LockIcon class="size-4 shrink-0 text-ink-muted" />
      </Show>
    </Show>
  );
}

function NewConversationDialog(props: ManagedDialogProps) {
  const sections = useFeatureFlag(enableChatSidebarSections);
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();
  const ownerId = userId();
  const { channels } = useChannelsContext();
  const { users } = useCombinedRecipients(['user']);
  const agents = ENABLE_AGENT_DMS ? useAgentDmRecipients() : () => [];
  const [selected, setSelected] = createSignal<ConversationRecipient[]>([]);
  const [query, setQuery] = createSignal('');
  const [privateChannel, setPrivateChannel] = createSignal(false);
  const [autoJoinTeam, setAutoJoinTeam] = createSignal(true);
  const [showInvites, setShowInvites] = createSignal(false);
  const [invitees, setInvitees] = createSignal<ConversationRecipient[]>([]);
  const [duplicateConfirmed, setDuplicateConfirmed] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [setupProgress, setSetupProgress] = createSignal<ChannelSetupProgress>(
    {}
  );
  const teamQuery = useCurrentTeamQuery();
  const team = () =>
    queryReadyGate(teamQuery) ? teamQuery.data?.team : undefined;
  const channelName = () => query().trim();
  const creatingChannel = () =>
    selected().length === 0 && channelName().length > 0;
  const locked = () => pending() || Boolean(setupProgress().channelId);
  const inviteAgents = useAgentsQuery(() => creatingChannel() && showInvites());
  const inviteOptions = createMemo(() => [
    ...users(),
    ...(inviteAgents.isSuccess ? inviteAgents.data : []).map((agent) =>
      recipientEntityMapper('agent')(agent.bot)
    ),
  ]);
  const options = createMemo<ConversationOption[]>(() =>
    [
      ...users().filter((option) => option.id !== userId()),
      ...agents(),
      ...(selected().length === 0
        ? channels()
            .filter((channel) => channel.channel_type !== 'direct_message')
            .map(recipientEntityMapper('channel'))
        : []),
    ].filter(
      (option) => !selected().some((recipient) => recipient.id === option.id)
    )
  );
  const suggestions = createMemo(() => {
    const matches = searchOptions(options(), query()).map(
      (result) => result.item
    );
    const email = query().trim().toLowerCase();
    const id = emailToMacroId(email);
    if (
      id &&
      EmailValidator.validate(email) &&
      id !== userId() &&
      !selected().some((option) => option.id === id) &&
      !options().some(
        (option) =>
          (option.kind === 'user' || option.kind === 'contact') &&
          option.data.email.toLowerCase() === email
      )
    ) {
      matches.unshift(
        recipientEntityMapper('custom')({ id, email, invalid: false })
      );
    }
    return matches.slice(0, 3);
  });
  const duplicates = createMemo(() =>
    channels().filter(
      (channel) =>
        channel.id !== setupProgress().channelId &&
        channel.channel_type !== 'direct_message' &&
        channel.name?.trim().toLocaleLowerCase() ===
          channelName().toLocaleLowerCase()
    )
  );
  const recipients = () => {
    const agent = selected().find((option) => option.kind === 'agent');
    return agent
      ? [`bot|${agent.id}`]
      : getDestinationFromOptions(selected()).users;
  };
  const existing = createMemo(() => {
    const ids = new Set([userId(), ...recipients()]);
    if (recipients().length === 0) return;
    return channels().find(
      (channel) =>
        (recipients().length === 1
          ? channel.channel_type === 'direct_message'
          : channel.channel_type === 'private') &&
        channel.participants.length === ids.size &&
        channel.participants.every((participant) =>
          ids.has(participant.user_id)
        )
    );
  });
  const canSubmit = () => {
    if (
      !active ||
      !props.open ||
      !sections().enabled ||
      !userId() ||
      userId() !== ownerId ||
      pending()
    )
      return false;
    if (setupProgress().channelId) {
      return (
        setupInput !== undefined &&
        setupInput.creatorId === userId() &&
        (setupInput.channelType === 'private' ||
          setupInput.teamId === team()?.id)
      );
    }
    if (selected().length > 0) return query().trim().length === 0;
    return (
      channelName().length > 0 &&
      channelName().length <= 80 &&
      (privateChannel() || Boolean(team())) &&
      (duplicates().length === 0 || duplicateConfirmed())
    );
  };
  const direct = useGetOrCreateDirectMessageMutation();
  const group = useGetOrCreatePrivateChannelMutation();
  const create = useCreateChannelMutation();
  const addParticipants = useAddParticipantsMutation();
  const addAgent = useAddBotToChannelMutation();
  const patch = usePatchChannelMutation();
  let setupInput: ChannelSetupInput | undefined;
  let inputRef: HTMLInputElement | undefined;
  let suggestionsRef: HTMLUListElement | undefined;
  let active = true;
  onCleanup(() => {
    active = false;
  });
  createEffect(
    on(
      () => sections().enabled,
      (enabled) => {
        if (enabled) return;
        active = false;
        props.onOpenChange(false);
      }
    )
  );
  createEffect(
    on(userId, (id) => {
      if (id === ownerId) return;
      active = false;
      props.onOpenChange(false);
    })
  );

  const open = (id: string) => {
    if (!active || !sections().enabled || userId() !== ownerId) return;
    props.onOpenChange(false);
    openWithSplit(
      { type: 'channel', id },
      { referredFrom: 'channels', reopen: 'latest' }
    );
  };
  const selectOption = (option: ConversationOption) => {
    if (locked()) return;
    if (option.kind === 'channel') {
      open(option.id);
      return;
    }
    setSelected(selectConversationRecipients([...selected(), option]));
    setQuery('');
    setError('');
    setDuplicateConfirmed(false);
    inputRef?.focus();
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const actor = userId();
    if (!actor || !canSubmit()) return;
    const isCurrent = () =>
      active && sections().enabled && props.open && userId() === actor;
    setPending(true);
    setError('');
    try {
      if (selected().length > 0) {
        const ids = recipients();
        const result = await Telemetry.span(
          'conversation.resolve',
          async (span) => {
            span.setAttr('conversation.recipient_count', ids.length);
            const resolved =
              ids.length === 1
                ? await direct.mutateAsync({ recipient_id: ids[0] })
                : await group.mutateAsync({ recipients: ids });
            span.setAttr('channel.id', resolved.channel_id);
            return resolved;
          }
        );
        if (isCurrent()) open(result.channel_id);
        return;
      }

      if (!setupProgress().channelId)
        setupInput = {
          name: channelName(),
          channelType: privateChannel() ? 'private' : 'team',
          teamId: privateChannel() ? undefined : team()?.id,
          creatorId: actor,
          participantIds: getDestinationFromOptions(invitees()).users,
          agentIds: invitees()
            .filter((option) => option.kind === 'agent')
            .map((option) => option.id),
          autoJoinTeam: autoJoinTeam(),
        };
      if (!setupInput) return;
      const input = setupInput;
      const id = await Telemetry.span('conversation.create', async (span) => {
        span.setAttr('channel.type', input.channelType);
        span.setAttr(
          'conversation.recipient_count',
          input.participantIds.length + input.agentIds.length
        );
        const id = await completeChannelSetup(
          input,
          setupProgress(),
          {
            isCurrent,
            canContinue: () =>
              input.channelType === 'private' || team()?.id === input.teamId,
            create: (value) =>
              span.span('channel.create', async (child) => {
                const result = await create.mutateAsync({
                  name: value.name,
                  channel_type: value.channelType,
                  team_id: value.teamId,
                  participants:
                    value.channelType === 'team' ? [value.creatorId] : [],
                  auto_join_team: false,
                });
                child.setAttr('channel.id', result.id);
                span.setAttr('channel.id', result.id);
                return result.id;
              }),
            addParticipants: (channelId, participants) =>
              span.span('channel.invite_people', () =>
                addParticipants.mutateAsync({ channelId, participants })
              ),
            addAgent: (channelId, botId) =>
              span.span('channel.invite_agent', () =>
                addAgent.mutateAsync({ channelId, botId })
              ),
            enableAutoJoin: (channelId) =>
              span.span('channel.auto_join', () =>
                patch.mutateAsync({ channelId, auto_join_team: true })
              ),
          },
          setSetupProgress
        );
        if (id) span.setAttr('channel.id', id);
        return id;
      });
      if (id && isCurrent()) open(id);
      else if (isCurrent())
        setError(
          t(
            setupProgress().channelId
              ? 'channelSections.channelSetupFailed'
              : 'channelSections.creationFailed'
          )
        );
    } catch {
      if (isCurrent())
        setError(
          t(
            setupProgress().channelId
              ? 'channelSections.channelSetupFailed'
              : 'channelSections.creationFailed'
          )
        );
    } finally {
      if (active) setPending(false);
    }
  };

  const moveSuggestionFocus = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(
      suggestionsRef?.querySelectorAll<HTMLButtonElement>('button') ?? []
    );
    if (locked() || buttons.length === 0 || !suggestionsRef?.isConnected)
      return;
    event.preventDefault();
    event.stopPropagation();
    const index =
      event.target instanceof HTMLButtonElement
        ? buttons.indexOf(event.target)
        : -1;
    let next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (index === -1) next = event.key === 'ArrowDown' ? 0 : buttons.length - 1;
    if (buttons[next]) buttons[next].focus();
    else inputRef?.focus();
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      class="w-[min(36rem,90vw)]"
    >
      <form
        class="flex max-h-[85dvh] flex-col gap-5 overflow-y-auto p-5"
        onSubmit={(event) => fireAndForget(submit(event), 'new-conversation')}
        aria-busy={pending()}
      >
        <div>
          <Dialog.Title class="text-lg font-semibold">
            {t('channelSections.newConversation')}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-ink-muted">
            {t('channelSections.nameFirstDescription')}
          </Dialog.Description>
        </div>
        <div class="flex flex-col gap-3">
          <Show when={selected().length > 0}>
            <div class="flex flex-wrap gap-2">
              <For each={selected()}>
                {(recipient) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={locked()}
                    aria-label={t('channelSections.removeRecipient', {
                      name: optionName(recipient),
                    })}
                    onClick={() => {
                      setSelected(
                        selected().filter(
                          (option) => option.id !== recipient.id
                        )
                      );
                      setError('');
                      inputRef?.focus();
                    }}
                  >
                    <OptionIcon option={recipient} />
                    <span class="max-w-48 truncate">
                      {optionName(recipient)}
                    </span>
                    <XIcon class="size-3" />
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <InputGroup size="xl">
            <InputGroup.Addon>
              <Show
                when={selected().length > 0}
                fallback={<HashIcon class="size-4" />}
              >
                <UserPlusIcon class="size-4" />
              </Show>
            </InputGroup.Addon>
            <InputGroup.Input
              ref={inputRef}
              aria-label={t('channelSections.nameOrPerson')}
              placeholder={t(
                selected().length > 0
                  ? 'channelSections.addPerson'
                  : 'channelSections.nameOrPerson'
              )}
              value={query()}
              readOnly={locked()}
              autocomplete="off"
              data-1p-ignore
              onKeyDown={moveSuggestionFocus}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setDuplicateConfirmed(false);
                setError('');
              }}
            />
          </InputGroup>
          <Show when={!locked() && suggestions().length > 0}>
            <ul
              ref={suggestionsRef}
              onKeyDown={moveSuggestionFocus}
              aria-label={t('channelSections.suggestions')}
              class="flex flex-col gap-1"
            >
              <For each={suggestions()}>
                {(option) => (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      fullWidth
                      class="justify-start"
                      onClick={() => selectOption(option)}
                    >
                      <OptionIcon option={option} />
                      <span class="min-w-0 flex-1 truncate text-left">
                        {optionName(option)}
                      </span>
                      <span class="shrink-0 text-xs text-ink-muted">
                        {option.kind === 'channel'
                          ? t('channelSections.openChannel')
                          : option.kind === 'custom'
                            ? t('channelSections.invitePerson')
                            : t('channelSections.messagePerson')}
                      </span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <Show when={creatingChannel()}>
          <div class="flex flex-col gap-4">
            <Show when={duplicates().length > 0}>
              <div class="flex flex-col gap-2">
                <p class="text-sm text-ink-muted">
                  {t('channelSections.matchingChannels')}
                </p>
                <ToggleSwitch
                  checked={duplicateConfirmed()}
                  onChange={setDuplicateConfirmed}
                  disabled={locked()}
                  label={t('channelSections.createAnyway')}
                />
              </div>
            </Show>
            <Show when={channelName().length > 80}>
              <p role="alert" class="text-sm text-failure">
                {t('channelSections.channelNameTooLong')}
              </p>
            </Show>
            <div class="flex flex-col gap-3">
              <ToggleSwitch
                checked={privateChannel()}
                onChange={setPrivateChannel}
                disabled={locked()}
                label={t('channelSections.privateChannel')}
              />
              <p class="text-xs text-ink-muted">
                {t(
                  privateChannel()
                    ? 'channelSections.privateChannelDescription'
                    : 'channelSections.teamChannelDescription'
                )}
              </p>
              <Show when={!privateChannel()}>
                <ToggleSwitch
                  checked={autoJoinTeam()}
                  onChange={setAutoJoinTeam}
                  disabled={locked()}
                  label={t('channelSections.autoJoinTeam')}
                />
              </Show>
            </div>
            <Show
              when={showInvites()}
              fallback={
                <Button
                  type="button"
                  variant="ghost"
                  class="self-start"
                  onClick={() => setShowInvites(true)}
                  disabled={locked()}
                >
                  <UserPlusIcon class="size-4" />
                  {t('channelSections.addPeopleOrAgents')}
                </Button>
              }
            >
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">
                  {t('channelSections.addPeopleOrAgents')}
                </span>
                <RecipientSelector<'user' | 'contact' | 'agent'>
                  options={inviteOptions}
                  selectedOptions={invitees()}
                  setSelectedOptions={setInvitees}
                  placeholder={t('channelSections.invitePlaceholder')}
                  portalScope="local"
                  disabled={locked()}
                  inviteExternalEmails
                />
              </div>
            </Show>
          </div>
        </Show>
        <Show when={error()}>
          <p role="alert" class="text-sm text-failure">
            {error()}
          </p>
        </Show>
        <div class="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending()}
            onClick={() => {
              const id = setupProgress().channelId;
              if (id) open(id);
              else props.onOpenChange(false);
            }}
          >
            {t(
              setupProgress().channelId
                ? 'channelSections.openChannel'
                : 'channelSections.cancel'
            )}
          </Button>
          <Button type="submit" disabled={!canSubmit()}>
            {pending()
              ? t('channelSections.saving')
              : setupProgress().channelId
                ? t('channelSections.retry')
                : selected().length > 0
                  ? t(
                      existing()
                        ? 'channelSections.openConversation'
                        : 'channelSections.startConversation'
                    )
                  : t('channelSections.createChannel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function openNewConversationDialog() {
  if (!isFeatureEnabled(enableChatSidebarSections)) return;
  openDialog(NewConversationDialog, {});
}
