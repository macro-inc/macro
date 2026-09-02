import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { toast } from '@core/component/Toast/Toast';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import MacroLogo from '@icon/macro-logo.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import TrashIcon from '@phosphor/trash.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import XIcon from '@phosphor/x.svg';
import {
  type AgentWithHarnessId,
  type CreateAgentParams,
  useAgentsQuery,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from '@queries/agents/agents';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
} from '@queries/auth/cursor-api-key';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery, useIsTeamOwner } from '@queries/team/teams';
import { Avatar, Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { botAssignableChannelOptions } from '../channel/Bots/botChannelOptions';
import { canDeleteBot } from '../channel/Bots/botPermissions';
import { ChannelMultiSelect } from '../channel/Bots/ChannelMultiSelect';
import {
  ChoiceRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from './primitives';

type AgentShare = 'Private' | 'Team';
type ChannelMode = 'all' | 'selected';

type AgentSummary = {
  id: string;
  name: string;
  tag: string;
  avatarUrl?: string;
  instructions: string;
  harness: string;
  defaultModel: string;
  channelSummary: string;
  share: AgentShare;
  persistedAgent?: AgentWithHarnessId;
  editable?: boolean;
};

type ConnectedHarness = {
  id: string;
  name: string;
  models: readonly HarnessModel[];
  kind: 'builtin' | 'macrod';
  connected?: boolean;
};

type HarnessModel = {
  id: string;
  name: string;
};

type ChannelOption = ReturnType<typeof botAssignableChannelOptions>[number];

const IN_MEMORY_HARNESS: ConnectedHarness = {
  id: 'in-memory',
  name: 'In-memory',
  models: [Model.sonnet5, Model.opus5, Model.haiku45, Model.gpt56].map(
    (model) => ({ id: model, name: MODEL_PRETTYNAME[model] })
  ),
  kind: 'builtin',
};

const MACRO_AGENT: AgentSummary = {
  id: MACRO_AGENT_BOT_ID,
  name: 'Macro',
  tag: 'macro',
  instructions: '',
  harness: 'In-memory',
  defaultModel: MODEL_PRETTYNAME[Model.sonnet5],
  channelSummary: 'All channels',
  share: 'Team',
};

/** Settings page for viewing and creating persistent agents. */
export function Agents() {
  const [creating, setCreating] = createSignal(false);
  const [editingAgent, setEditingAgent] = createSignal<AgentWithHarnessId>();
  const [deletingAgent, setDeletingAgent] = createSignal<AgentWithHarnessId>();
  const channelsContext = useChannelsContext();
  const currentUserId = useUserId();
  const agentsQuery = useAgentsQuery();
  const createAgentMutation = useCreateAgentMutation();
  const deleteAgentMutation = useDeleteAgentMutation();
  const updateAgentMutation = useUpdateAgentMutation();
  const currentTeamQuery = useCurrentTeamQuery();
  const isTeamOwner = useIsTeamOwner();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () => cursorStatus.data?.registered ?? false;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const harnessesQuery = useHarnessesQuery();
  const connectedHarnesses = (): readonly ConnectedHarness[] => [
    IN_MEMORY_HARNESS,
    ...(cursorConnected()
      ? [
          {
            id: 'cursor',
            name: 'Cursor',
            models: (cursorModels.data?.models ?? []).map((model) => ({
              id: model.id,
              name: model.displayName,
            })),
            kind: 'builtin' as const,
          },
        ]
      : []),
    ...(harnessesQuery.data ?? []).map((harness) => ({
      id: harness.id,
      name:
        harness.owner.type === 'team' ? `${harness.name} · Team` : harness.name,
      models: [],
      kind: 'macrod' as const,
      connected: harness.connected,
    })),
  ];
  const channelOptions = createMemo(() =>
    botAssignableChannelOptions(channelsContext.channels())
  );
  const currentTeamId = () => currentTeamQuery.data?.team.id;
  const canShareWithTeam = () => currentTeamId() !== undefined;
  const isAgentCreator = (agent: AgentWithHarnessId) =>
    agent.bot.created_by === currentUserId();
  const canMakePrivate = (agent: AgentWithHarnessId) =>
    agent.bot.owner?.type !== 'team' || isAgentCreator(agent);
  const canDeleteAgent = (agent: AgentWithHarnessId) =>
    canDeleteBot(agent.bot, currentUserId(), currentTeamId(), isTeamOwner());
  const agents = createMemo(() =>
    (agentsQuery.data ?? []).map((agent) =>
      summarizeAgent(agent, connectedHarnesses(), channelOptions())
    )
  );
  const teamAgents = createMemo(() => [
    MACRO_AGENT,
    ...agents().filter((agent) => agent.share === 'Team'),
  ]);
  const privateAgents = createMemo(() =>
    agents().filter((agent) => agent.share === 'Private')
  );

  const createAgent = async (agent: CreateAgentParams) => {
    try {
      await createAgentMutation.mutateAsync(agent);
      toast.success('Agent created');
      return true;
    } catch {
      toast.failure('Failed to create agent');
      return false;
    }
  };

  const updateAgent = async (agent: CreateAgentParams) => {
    const current = editingAgent();
    if (!current) return false;

    try {
      await updateAgentMutation.mutateAsync({
        ...agent,
        agentId: current.bot.id,
        ...(current.bot.description
          ? { description: current.bot.description }
          : {}),
      });
      toast.success('Agent updated');
      return true;
    } catch {
      toast.failure('Failed to update agent');
      return false;
    }
  };

  const deleteAgent = async () => {
    const current = deletingAgent();
    if (!current) return;

    try {
      await deleteAgentMutation.mutateAsync({
        agentId: current.bot.id,
        channelIds: current.channel_ids,
      });
      setDeletingAgent(undefined);
      toast.success('Agent deleted');
    } catch {
      toast.failure('Failed to delete agent');
    }
  };

  return (
    <>
      <SettingsPage
        title="Agents"
        description="Create agents with their own identity, instructions, and runtime."
        actions={
          <Button variant="cta" size="sm" onClick={() => setCreating(true)}>
            <PlusIcon />
            Create agent
          </Button>
        }
      >
        <SettingsSection
          title="Team agents"
          description="Agents shared with your team, including Macro."
        >
          <SettingsCard>
            <For each={teamAgents()}>
              {(agent) => (
                <AgentRow
                  agent={agent}
                  onEdit={
                    agent.editable && agent.persistedAgent
                      ? () => setEditingAgent(agent.persistedAgent)
                      : undefined
                  }
                  onDelete={
                    agent.persistedAgent && canDeleteAgent(agent.persistedAgent)
                      ? () => setDeletingAgent(agent.persistedAgent)
                      : undefined
                  }
                />
              )}
            </For>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title="Private agents"
          description="Agents owned by you rather than your team."
        >
          <SettingsCard>
            <Show
              when={privateAgents().length > 0}
              fallback={
                <p class="px-6 py-4 text-sm text-ink-muted">
                  No private agents yet.
                </p>
              }
            >
              <For each={privateAgents()}>
                {(agent) => (
                  <AgentRow
                    agent={agent}
                    onEdit={
                      agent.editable && agent.persistedAgent
                        ? () => setEditingAgent(agent.persistedAgent)
                        : undefined
                    }
                    onDelete={
                      agent.persistedAgent &&
                      canDeleteAgent(agent.persistedAgent)
                        ? () => setDeletingAgent(agent.persistedAgent)
                        : undefined
                    }
                  />
                )}
              </For>
            </Show>
            <Show when={agentsQuery.isError}>
              <p class="px-6 py-4 text-xs text-negative">
                Could not load your agents. Try refreshing this page.
              </p>
            </Show>
          </SettingsCard>
        </SettingsSection>
      </SettingsPage>

      <Show when={creating()}>
        <AgentDialog
          connectedHarnesses={connectedHarnesses()}
          currentTeamId={currentTeamId()}
          canShareWithTeam={canShareWithTeam()}
          canMakePrivate
          pending={createAgentMutation.isPending}
          onClose={() => setCreating(false)}
          onSave={createAgent}
        />
      </Show>
      <Show when={editingAgent()} keyed>
        {(agent) => (
          <AgentDialog
            agent={agent}
            connectedHarnesses={connectedHarnesses()}
            currentTeamId={currentTeamId()}
            canShareWithTeam={canShareWithTeam()}
            canMakePrivate={canMakePrivate(agent)}
            pending={updateAgentMutation.isPending}
            onClose={() => setEditingAgent(undefined)}
            onSave={updateAgent}
          />
        )}
      </Show>
      <Show when={deletingAgent()} keyed>
        {(agent) => (
          <AgentDeleteDialog
            agentName={agent.bot.name}
            pending={deleteAgentMutation.isPending}
            onClose={() => setDeletingAgent(undefined)}
            onConfirm={() => void deleteAgent()}
          />
        )}
      </Show>
    </>
  );
}

function summarizeAgent(
  agent: AgentWithHarnessId,
  harnesses: readonly ConnectedHarness[],
  channels: readonly ChannelOption[]
): AgentSummary {
  const harnessKey = agent.harness_id ?? agent.harness;
  const harness = harnesses.find((option) => option.id === harnessKey);
  const model = harness?.models.find(
    (option) => option.id === agent.default_model
  );
  const selectedChannelNames = channels
    .filter((channel) => agent.channel_ids.includes(channel.id))
    .map((channel) => `#${channel.name}`);
  const channelSummary =
    agent.channel_scope === 'all'
      ? 'All channels'
      : selectedChannelNames.length > 0
        ? selectedChannelNames.join(', ')
        : `${agent.channel_ids.length} selected ${agent.channel_ids.length === 1 ? 'channel' : 'channels'}`;

  return {
    id: agent.bot.id,
    name: agent.bot.name,
    tag: agent.bot.handle,
    avatarUrl: agent.bot.avatar_url ?? undefined,
    instructions: agent.instructions,
    harness: harness?.name ?? harnessName(harnessKey),
    defaultModel: model?.name ?? agent.default_model,
    channelSummary,
    share: agent.bot.owner?.type === 'team' ? 'Team' : 'Private',
    persistedAgent: agent,
    editable: true,
  };
}

function harnessName(id: string): string {
  if (id === 'in-memory') return 'In-memory';
  if (id === 'cursor') return 'Cursor';
  // Any other id is a registered macrod harness uuid; if it is not in the
  // connected list any more, the harness has been removed.
  return 'Disconnected harness';
}

function AgentRow(props: {
  agent: AgentSummary;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div class="flex items-center gap-4 px-6 py-4 mobile:items-start touch:px-4">
      <AgentAvatar agent={props.agent} />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-sm font-medium text-ink">
            {props.agent.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.agent.tag}
          </span>
          <span class="shrink-0 rounded-full border border-edge-muted px-2 py-0.5 text-xxs font-medium uppercase text-ink-extra-muted">
            {props.agent.share}
          </span>
        </div>
        <p class="mt-0.5 text-xs text-ink-extra-muted">
          {props.agent.harness} · {props.agent.defaultModel} ·{' '}
          {props.agent.channelSummary}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.onEdit}>
          {(onEdit) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${props.agent.name}`}
              onClick={onEdit()}
            >
              <PencilIcon />
            </Button>
          )}
        </Show>
        <Show when={props.onDelete}>
          {(onDelete) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="text-negative"
              aria-label={`Delete ${props.agent.name}`}
              onClick={onDelete()}
            >
              <TrashIcon />
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

function AgentAvatar(props: { agent: AgentSummary }) {
  return (
    <Avatar size="lg" class="bg-surface text-accent ring ring-edge-muted">
      <Show
        when={props.agent.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <Show
              when={props.agent.id === MACRO_AGENT_BOT_ID}
              fallback={<RobotIcon class="size-5" />}
            >
              <MacroLogo class="size-5" />
            </Show>
          </Avatar.Fallback>
        }
      >
        {(avatarUrl) => (
          <Avatar.Image src={avatarUrl()} alt={`${props.agent.name} avatar`} />
        )}
      </Show>
    </Avatar>
  );
}

function AgentDeleteDialog(props: {
  agentName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Delete {props.agentName}?
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            This removes the agent from every channel and permanently deletes
            its configuration. This action cannot be undone.
          </Dialog.Description>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            <TrashIcon />
            {props.pending ? 'Deleting…' : 'Delete agent'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

function AgentDialog(props: {
  agent?: AgentWithHarnessId;
  connectedHarnesses: readonly ConnectedHarness[];
  currentTeamId?: string;
  canShareWithTeam: boolean;
  canMakePrivate: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (agent: CreateAgentParams) => Promise<boolean>;
}) {
  const [name, setName] = createSignal(props.agent?.bot.name ?? '');
  const [tag, setTag] = createSignal(props.agent?.bot.handle ?? '');
  const [tagEdited, setTagEdited] = createSignal(props.agent !== undefined);
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(
    props.agent?.bot.avatar_url ?? undefined
  );
  const [instructions, setSystemPrompt] = createSignal(
    props.agent?.instructions ?? ''
  );
  const [harnessId, setHarnessId] = createSignal(
    props.agent?.harness_id ??
      props.agent?.harness ??
      props.connectedHarnesses[0]?.id ??
      ''
  );
  const selectedHarness = () =>
    props.connectedHarnesses.find((harness) => harness.id === harnessId());
  const [defaultModelId, setDefaultModelId] = createSignal(
    props.agent?.default_model ?? ''
  );
  const selectedDefaultModelId = () =>
    defaultModelId() || selectedHarness()?.models[0]?.id || '';
  const [channelMode, setChannelMode] = createSignal<ChannelMode>(
    props.agent?.channel_scope ?? 'all'
  );
  const [selectedChannelIds, setSelectedChannelIds] = createSignal<string[]>(
    props.agent?.channel_ids ?? []
  );
  const [share, setShare] = createSignal<AgentShare>(
    props.agent?.bot.owner?.type === 'team' ? 'Team' : 'Private'
  );
  let avatarInputRef: HTMLInputElement | undefined;

  const close = () => props.onClose();

  const handleNameInput = (value: string) => {
    setName(value);
    if (!tagEdited()) setTag(slugAgentTag(value));
  };

  const handleHarnessChange = (id: string) => {
    setHarnessId(id);
    const harness = props.connectedHarnesses.find((option) => option.id === id);
    // macrod treats 'default' as "use the harness's own configured model".
    setDefaultModelId(
      harness?.kind === 'macrod' ? 'default' : (harness?.models[0]?.id ?? '')
    );
  };

  const handleAvatarInput = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') setAvatarUrl(reader.result);
    });
    reader.readAsDataURL(file);
  };

  const canCreate = () =>
    !props.pending &&
    name().trim().length > 0 &&
    tag().trim().length > 0 &&
    selectedHarness() !== undefined &&
    selectedDefaultModelId().length > 0 &&
    (channelMode() === 'all' || selectedChannelIds().length > 0) &&
    (share() === 'Private' ? props.canMakePrivate : props.canShareWithTeam);

  const selectedTeamId = () => {
    if (share() === 'Private') return undefined;
    const currentOwner = props.agent?.bot.owner;
    return currentOwner?.type === 'team'
      ? currentOwner.team_id
      : props.currentTeamId;
  };

  const submit = async () => {
    if (!canCreate()) return;

    const harness = selectedHarness();
    const saved = await props.onSave({
      avatarUrl: avatarUrl(),
      channelIds: channelMode() === 'all' ? [] : selectedChannelIds(),
      channelScope: channelMode(),
      defaultModel: selectedDefaultModelId(),
      handle: slugAgentTag(tag()),
      // Registered macrod harnesses send the 'macrod' slug plus their uuid;
      // built-ins keep sending their own slug with no harness id.
      harness: harness?.kind === 'macrod' ? 'macrod' : (harness?.id ?? ''),
      harnessId: harness?.kind === 'macrod' ? harness.id : undefined,
      name: name().trim(),
      instructions: instructions().trim(),
      teamId: selectedTeamId(),
    });
    if (saved) close();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      position="center"
      visibleScrim
      class="w-[min(720px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="max-h-[88vh] rounded-xl text-ink">
        <Panel.Header class="justify-between px-3">
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {props.agent ? 'Edit agent' : 'Create agent'}
          </Dialog.Title>
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
        </Panel.Header>

        <Panel.Body class="overflow-y-auto p-5">
          <form
            id="agent-form"
            class="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <AgentFormSection
              title="Profile"
              description="How this agent appears in channels and mentions."
            >
              <div class="flex items-center gap-3 border-b border-edge-muted pb-4">
                <button
                  type="button"
                  aria-label="Upload avatar"
                  class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => avatarInputRef?.click()}
                >
                  <AgentAvatar
                    agent={{
                      id: 'draft',
                      name: name() || 'Agent',
                      tag: tag(),
                      avatarUrl: avatarUrl(),
                      instructions: '',
                      harness: '',
                      defaultModel: '',
                      channelSummary: '',
                      share: share(),
                    }}
                  />
                </button>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-ink">Avatar</div>
                  <div class="mt-0.5 text-xs text-ink-muted">
                    Optional · square images work best
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={(event) =>
                    handleAvatarInput(event.currentTarget.files?.[0])
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => avatarInputRef?.click()}
                >
                  <UploadIcon />
                  Upload
                </Button>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-3 mobile:grid-cols-1">
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">Name</span>
                  <input
                    autofocus
                    class="settings-input w-full"
                    placeholder="Bug fixer"
                    value={name()}
                    onInput={(event) =>
                      handleNameInput(event.currentTarget.value)
                    }
                  />
                </label>
                <label for="agent-tag" class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">@tag</span>
                  <div class="flex items-center rounded-lg border border-edge-muted px-2 focus-within:border-accent">
                    <span class="text-sm text-ink-extra-muted">@</span>
                    <input
                      id="agent-tag"
                      aria-label="@tag"
                      class="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm text-ink outline-none"
                      placeholder="bug-fixer"
                      value={tag()}
                      onInput={(event) => {
                        setTagEdited(true);
                        setTag(slugAgentTag(event.currentTarget.value));
                      }}
                    />
                  </div>
                </label>
              </div>
            </AgentFormSection>

            <AgentFormSection
              title="Behavior"
              description="Instructions the agent receives at the start of every conversation."
            >
              <label class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-ink">System prompt</span>
                <textarea
                  rows={5}
                  class="settings-input h-auto min-h-30 w-full resize-y px-3 py-2.5 font-mono text-xs leading-5"
                  placeholder="You are a bug-fixing agent. Reproduce issues, identify root causes, and make focused, tested fixes…"
                  value={instructions()}
                  onInput={(event) =>
                    setSystemPrompt(event.currentTarget.value)
                  }
                />
              </label>
            </AgentFormSection>

            <AgentFormSection
              title="Runtime"
              description="Harnesses and models are limited to those currently connected."
            >
              <div class="grid grid-cols-2 gap-3 mobile:grid-cols-1">
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">Harness</span>
                  <select
                    class="settings-input w-full"
                    value={harnessId()}
                    onChange={(event) =>
                      handleHarnessChange(event.currentTarget.value)
                    }
                  >
                    <For each={props.connectedHarnesses}>
                      {(harness) => (
                        <option value={harness.id}>{harness.name}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">
                    Default model
                  </span>
                  <Show
                    when={selectedHarness()?.kind === 'macrod'}
                    fallback={
                      <select
                        class="settings-input w-full"
                        value={selectedDefaultModelId()}
                        onChange={(event) =>
                          setDefaultModelId(event.currentTarget.value)
                        }
                      >
                        <For each={selectedHarness()?.models ?? []}>
                          {(model) => (
                            <option
                              value={model.id}
                              selected={model.id === selectedDefaultModelId()}
                            >
                              {model.name}
                            </option>
                          )}
                        </For>
                      </select>
                    }
                  >
                    <input
                      class="settings-input w-full"
                      placeholder="default"
                      value={defaultModelId()}
                      onInput={(event) =>
                        setDefaultModelId(event.currentTarget.value)
                      }
                    />
                  </Show>
                </label>
              </div>
            </AgentFormSection>

            <AgentFormSection
              title="Channels"
              description="Choose whether this agent is global or channel-specific."
            >
              <fieldset class="flex flex-col gap-2">
                <legend class="sr-only">Channels</legend>
                <ChoiceRow
                  name="agent-channel-mode"
                  value="all"
                  checked={channelMode() === 'all'}
                  title="All channels"
                  description="The agent can be mentioned in every channel, like @macro."
                  onChange={() => setChannelMode('all')}
                />
                <ChoiceRow
                  name="agent-channel-mode"
                  value="selected"
                  checked={channelMode() === 'selected'}
                  title="Specific channels"
                  description="Only members of selected channels can use this agent."
                  onChange={() => setChannelMode('selected')}
                />
              </fieldset>

              <Show when={channelMode() === 'selected'}>
                <div class="mt-3 border-t border-edge-muted pt-3">
                  <ChannelMultiSelect
                    channelIds={selectedChannelIds()}
                    onChange={setSelectedChannelIds}
                  />
                </div>
              </Show>
            </AgentFormSection>

            <AgentFormSection
              title="Share"
              description="Choose who owns and can configure this agent."
            >
              <fieldset class="grid grid-cols-2 gap-2 mobile:grid-cols-1">
                <legend class="sr-only">Share</legend>
                <ChoiceRow
                  name="agent-share"
                  value="private"
                  checked={share() === 'Private'}
                  title="Private"
                  description={
                    props.canMakePrivate
                      ? 'Only you can use and manage this agent.'
                      : 'Only the agent creator can make it private.'
                  }
                  disabled={!props.canMakePrivate}
                  onChange={() => setShare('Private')}
                />
                <ChoiceRow
                  name="agent-share"
                  value="team"
                  checked={share() === 'Team'}
                  title="Team"
                  description={
                    props.canShareWithTeam
                      ? 'Your team can use this agent in shared channels.'
                      : 'Create or join a team before sharing agents.'
                  }
                  disabled={!props.canShareWithTeam}
                  onChange={() => setShare('Team')}
                />
              </fieldset>
              <Show when={!props.canShareWithTeam}>
                <p class="mt-3 border-t border-edge-muted pt-3 text-xs text-ink-extra-muted">
                  Team agents need a team owner. Create or join a team in Team
                  settings to enable this option.
                </p>
              </Show>
            </AgentFormSection>
          </form>
        </Panel.Body>

        <Panel.Footer class="justify-end gap-2 px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="agent-form"
            variant="cta"
            size="sm"
            disabled={!canCreate()}
          >
            {props.pending
              ? props.agent
                ? 'Saving…'
                : 'Creating…'
              : props.agent
                ? 'Save changes'
                : 'Create agent'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

function AgentFormSection(props: {
  title: string;
  description: string;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <section>
      <div class="mb-2 px-1">
        <h2 class="text-sm font-semibold text-ink">{props.title}</h2>
        <p class="mt-0.5 text-xs text-ink-muted">{props.description}</p>
      </div>
      <div class="rounded-xl border border-ink/[0.06] bg-surface-2 p-4">
        {props.children}
      </div>
    </section>
  );
}

function slugAgentTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
