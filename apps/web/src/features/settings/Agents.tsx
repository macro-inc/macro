import { useOpenAgentDm } from '@app/features/agent-dms/open-agent-dm';
import {
  type AgentKind,
  isCoderHarness,
} from '@app/features/agents-view/core/agent-kind';
import { AGENTS_TOUR } from '@app/features/agents-view/tour';
import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_AGENT_DMS } from '@core/constant/featureFlags';
import {
  MACRO_AGENT_BOT_ID,
  MACRO_HARNESS_NAME,
} from '@core/constant/macroAgent';
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { fireAndForget } from '@core/util/fireAndForget';
import MacroLogo from '@icon/macro-logo.svg';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import TerminalIcon from '@icon/system/regular/terminal-window.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import {
  removeAgentApiKey,
  saveAgentApiKey,
  useAgentApiKeyQuery,
} from '@queries/agents/agent-api-key';
import {
  type AgentWithHarnessId,
  type CreateAgentParams,
  useAgentsQuery,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from '@queries/agents/agents';
import { useUploadAgentAvatarMutation } from '@queries/agents/avatar';
import {
  type AgentModelTarget,
  buildAgentModelTargets,
  useAgentModelsQueries,
} from '@queries/agents/models';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import {
  useCurrentTeamQuery,
  useIsTeamAdmin,
  useIsTeamOwner,
} from '@queries/team/teams';
import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import type { AgentMcpServers } from '@service-storage/generated/schemas/agentMcpServers';
import { useSearchParams } from '@solidjs/router';
import { ApiKeyInput, Avatar, Button, Dialog, Panel } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { botAssignableChannelOptions } from '../channel/Bots/botChannelOptions';
import { canDeleteBot, canManageAgent } from '../channel/Bots/botPermissions';
import { ChannelMultiSelect } from '../channel/Bots/ChannelMultiSelect';
import {
  agentSettingsRequest,
  consumeAgentSettingsRequest,
} from './agentSettingsState';
import { CursorConnectPage } from './CursorConnectPage';
import { AgentSetupStrips } from './components/agent-setup-strips';
import { CodingPreferencesSetting } from './components/coding-preferences-setting';
import { AgentInstructionsEditor } from './components/instructions-editor';
import { SettingsSelect } from './components/settings-select';
import { WhereItRunsOption } from './components/where-it-runs-option';
import {
  type ApiKeyProvider,
  apiKeyProviderName,
  apiKeyProviderOf,
} from './core/agent-api-key';
import { PipedreamAppPicker } from './PipedreamAppPicker';
import {
  ChoiceRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
  SettingsSurface,
} from './primitives';
import { RuntimePairingPage } from './RuntimePairingPage';

type AgentShare = 'Private' | 'Team';
type ChannelMode = 'all' | 'selected';

type AgentSummary = {
  id: string;
  name: string;
  tag: string;
  avatarUrl?: string;
  instructions: string;
  /** "In Macro", "In Cursor", … for the row's subtitle. */
  whereItRuns: string;
  defaultModel: string;
  channelSummary: string;
  share: AgentShare;
  persistedAgent?: AgentWithHarnessId;
  editable?: boolean;
};

type ConnectedHarness = {
  id: string;
  name: string;
  kind: 'builtin' | 'macrod';
  allowPermissionBypass: boolean;
  target: AgentModelTarget;
  connected?: boolean;
};

type ChannelOption = ReturnType<typeof botAssignableChannelOptions>[number];

const IN_MEMORY_HARNESS: ConnectedHarness = {
  id: 'in-memory',
  name: MACRO_HARNESS_NAME,
  kind: 'builtin',
  allowPermissionBypass: true,
  target: { harness: 'in-memory' },
};

const MACRO_AGENT: AgentSummary = {
  id: MACRO_AGENT_BOT_ID,
  name: 'Macro',
  tag: 'macro',
  instructions: '',
  whereItRuns: 'In Macro',
  defaultModel: MODEL_PRETTYNAME[Model.sonnet55],
  channelSummary: 'All channels',
  share: 'Team',
};

/** Settings page for viewing and creating persistent agents. */
export function Agents(props: {
  createKind?: AgentKind;
  onCloseCreate?: () => void;
  onCursor: () => void;
  onSetUpRuntime: () => void;
  onManageRuntimes: () => void;
}) {
  const agentDm = ENABLE_AGENT_DMS ? useOpenAgentDm() : undefined;
  const messageAgent = (id: string) =>
    agentDm?.open(id === MACRO_AGENT_BOT_ID ? MACRO_NEW_BOT_ID : id);
  const agentList = tourTarget(AGENTS_TOUR.agentList);
  const [creating, setCreating] = createSignal(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const creatingFromLink = () => searchParams.createAgent === 'true';
  const closeCreateAgent = () => {
    setCreating(false);
    setEditingAgent(undefined);
    setDeletingAgent(undefined);
    props.onCloseCreate?.();
    if (creatingFromLink()) {
      setSearchParams({ createAgent: undefined }, { replace: true });
    }
  };
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
  const isTeamAdmin = useIsTeamAdmin();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const harnessesQuery = useHarnessesQuery();
  const connectedHarnesses = (): readonly ConnectedHarness[] => {
    const harnesses = harnessesQuery.isSuccess ? harnessesQuery.data : [];
    return buildAgentModelTargets(cursorConnected(), harnesses).map(
      (target) => {
        if (target.harness === 'in-memory') return IN_MEMORY_HARNESS;
        if (target.harness === 'cursor') {
          return {
            id: 'cursor',
            name: 'Cursor',
            kind: 'builtin',
            allowPermissionBypass: true,
            target,
          };
        }

        const harness = harnesses.find(
          (candidate) => candidate.id === target.harnessId
        );
        return {
          id: target.harnessId ?? '',
          name:
            harness?.owner.type === 'team'
              ? `${harness.name} · Team`
              : (harness?.name ?? 'macrod'),
          kind: 'macrod',
          allowPermissionBypass: harness?.allow_permission_bypass ?? false,
          target,
          connected: harness?.connected,
        };
      }
    );
  };
  const channelOptions = createMemo(() =>
    botAssignableChannelOptions(channelsContext.channels())
  );
  const currentTeamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;
  const canShareWithTeam = () => currentTeamId() !== undefined;
  const isAgentCreator = (agent: AgentWithHarnessId) =>
    agent.bot.created_by === currentUserId();
  const canMakePrivate = (agent: AgentWithHarnessId) =>
    agent.bot.owner?.type !== 'team' || isAgentCreator(agent);
  const canDeleteAgent = (agent: AgentWithHarnessId) =>
    canDeleteBot(
      agent.bot,
      currentUserId(),
      currentTeamId(),
      isTeamOwner(),
      isTeamAdmin()
    );
  const agents = createMemo(() =>
    (agentsQuery.isSuccess ? agentsQuery.data : [])
      .filter((agent) =>
        canManageAgent(agent.bot, currentUserId(), currentTeamId())
      )
      .map((agent) =>
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

  // Opened from an agent's user card: wait for the list, then show that
  // agent's editor if it is one the viewer manages.
  createEffect(
    on([agentSettingsRequest, () => agentsQuery.isPending], ([request]) => {
      if (!request || agentsQuery.isPending) return;
      const agent = agents().find(
        (candidate) => candidate.id === request.agentId
      );
      if (agent?.editable && agent.persistedAgent) {
        setCreating(false);
        setEditingAgent(agent.persistedAgent);
      }
      consumeAgentSettingsRequest(request.id);
    })
  );

  const createAgent = async (agent: CreateAgentParams) => {
    try {
      const created = await createAgentMutation.mutateAsync(agent);
      toast.success('Agent created');
      return created.bot.id;
    } catch {
      toast.failure('Failed to create agent');
      return undefined;
    }
  };

  const updateAgent = async (agent: CreateAgentParams) => {
    const current = editingAgent();
    if (!current) return undefined;

    try {
      await updateAgentMutation.mutateAsync({
        ...agent,
        agentId: current.bot.id,
        ...(current.bot.description
          ? { description: current.bot.description }
          : {}),
      });
      toast.success('Agent updated');
      return current.bot.id;
    } catch {
      toast.failure('Failed to update agent');
      return undefined;
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
      if (editingAgent()?.bot.id === current.bot.id) setEditingAgent(undefined);
      toast.success('Agent deleted');
    } catch {
      toast.failure('Failed to delete agent');
    }
  };

  return (
    <>
      <Show
        when={
          !creating() &&
          !creatingFromLink() &&
          !props.createKind &&
          !editingAgent()
        }
      >
        <SettingsPage
          title="Agents"
          description="Custom assistants with their own name, instructions, model, and place to run."
        >
          <AgentSetupStrips
            onCursor={props.onCursor}
            onSetUpRuntime={props.onSetUpRuntime}
            onManageRuntimes={props.onManageRuntimes}
          />
          <section ref={agentList} aria-label="Your agents">
            <SettingsSurface class="flex flex-col gap-2 p-5 touch:p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="text-base font-medium text-ink">Your agents</h2>
                  <p class="text-sm leading-relaxed text-ink/60">
                    Shared with your team or private to you.
                  </p>
                </div>
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
                  Add agent
                </Button>
              </div>
              <SettingsCard>
                <For each={[...teamAgents(), ...privateAgents()]}>
                  {(agent) => (
                    <AgentRow
                      agent={agent}
                      onMessage={
                        agentDm
                          ? () =>
                              fireAndForget(
                                messageAgent(agent.id),
                                'agent-settings'
                              )
                          : undefined
                      }
                      messagePending={agentDm?.pending()}
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
                <Show when={agentsQuery.isPending}>
                  <p class="px-6 py-4 text-sm text-ink-muted">
                    Loading agents…
                  </p>
                </Show>
                <Show when={agentsQuery.isError}>
                  <p class="px-6 py-4 text-xs text-negative">
                    Could not load your agents. Try refreshing this page.
                  </p>
                </Show>
              </SettingsCard>
            </SettingsSurface>
          </section>

          <CodingPreferencesSetting />
        </SettingsPage>
      </Show>

      <Show keyed when={props.createKind ?? (creating() || creatingFromLink())}>
        <AgentEditorPage
          initialKind={props.createKind}
          connectedHarnesses={connectedHarnesses()}
          currentTeamId={currentTeamId()}
          canShareWithTeam={canShareWithTeam()}
          canMakePrivate
          pending={createAgentMutation.isPending}
          onClose={closeCreateAgent}
          onSave={createAgent}
        />
      </Show>
      <Show when={!props.createKind && editingAgent()} keyed>
        {(agent) => (
          <AgentEditorPage
            agent={agent}
            connectedHarnesses={connectedHarnesses()}
            currentTeamId={currentTeamId()}
            canShareWithTeam={canShareWithTeam()}
            canMakePrivate={canMakePrivate(agent)}
            pending={updateAgentMutation.isPending}
            onClose={() => setEditingAgent(undefined)}
            onSave={updateAgent}
            onDelete={
              canDeleteAgent(agent) ? () => setDeletingAgent(agent) : undefined
            }
          />
        )}
      </Show>
      <Show when={!props.createKind && deletingAgent()} keyed>
        {(agent) => (
          <AgentDeleteDialog
            agentName={agent.bot.name}
            pending={deleteAgentMutation.isPending}
            onClose={() => setDeletingAgent(undefined)}
            onConfirm={() => fireAndForget(deleteAgent(), 'agent-settings')}
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
    whereItRuns: whereItRunsLabel(harnessKey, harness),
    defaultModel:
      MODEL_PRETTYNAME[agent.default_model as Model] ?? agent.default_model,
    channelSummary,
    share: agent.bot.owner?.type === 'team' ? 'Team' : 'Private',
    persistedAgent: agent,
    editable: true,
  };
}

function whereItRunsLabel(id: string, harness?: ConnectedHarness): string {
  if (id === 'in-memory') return 'In Macro';
  if (id === 'cursor') return 'In Cursor';
  // Any other id is a registered macrod harness uuid; if it is not in the
  // connected list any more, the harness has been removed.
  return harness ? `In your harness · ${harness.name}` : 'Disconnected runtime';
}

function AgentRow(props: {
  agent: AgentSummary;
  onEdit?: () => void;
  onDelete?: () => void;
  onMessage?: () => void;
  messagePending?: boolean;
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
          {props.agent.whereItRuns} · {props.agent.defaultModel} ·{' '}
          {props.agent.channelSummary}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.onMessage}>
          {(onMessage) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.messagePending}
              aria-label={`Message ${props.agent.name}`}
              onClick={onMessage()}
            >
              <ChatIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              Message
            </Button>
          )}
        </Show>
        <Show when={props.onEdit}>
          {(onEdit) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${props.agent.name}`}
              onClick={onEdit()}
            >
              <PencilIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
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
              <TrashIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
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
              fallback={<AgentIcon class="size-5" />}
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
            variant="secondary"
            size="sm"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            <TrashIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
            {props.pending ? 'Deleting…' : 'Delete agent'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

function AgentEditorPage(props: {
  initialKind?: AgentKind;
  agent?: AgentWithHarnessId;
  connectedHarnesses: readonly ConnectedHarness[];
  currentTeamId?: string;
  canShareWithTeam: boolean;
  canMakePrivate: boolean;
  pending: boolean;
  onClose: () => void;
  /** Saves the agent, resolving to its id, or `undefined` when it failed. */
  onSave: (agent: CreateAgentParams) => Promise<string | undefined>;
  onDelete?: () => void;
}) {
  const [name, setName] = createSignal(props.agent?.bot.name ?? '');
  const [tag, setTag] = createSignal(props.agent?.bot.handle ?? '');
  const [tagEdited, setTagEdited] = createSignal(props.agent !== undefined);
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(
    props.agent?.bot.avatar_url ?? undefined
  );
  const uploadAvatar = useUploadAgentAvatarMutation();
  const [uploadingAvatar, setUploadingAvatar] = createSignal(false);
  const busy = () => props.pending || uploadingAvatar();
  const [instructions, setInstructions] = createSignal(
    props.agent?.instructions ?? ''
  );
  const [harnessId, setHarnessId] = createSignal(
    props.agent?.harness_id ??
      props.agent?.harness ??
      (props.initialKind === 'coder'
        ? props.connectedHarnesses.find((harness) =>
            isCoderHarness(harness.kind === 'macrod' ? 'macrod' : harness.id)
          )?.id
        : undefined) ??
      props.connectedHarnesses[0]?.id ??
      ''
  );
  const modelQueries = useAgentModelsQueries(() =>
    props.connectedHarnesses.map((harness) => harness.target)
  );
  const selectedHarness = () =>
    props.connectedHarnesses.find((harness) => harness.id === harnessId());
  const modelQueryForHarness = (id: string) => {
    const index = props.connectedHarnesses.findIndex(
      (harness) => harness.id === id
    );
    return index >= 0 ? modelQueries[index] : undefined;
  };
  const modelDataForHarness = (id: string) => {
    const query = modelQueryForHarness(id);
    return query?.isSuccess ? query.data : undefined;
  };
  const preferredModelId = (id: string) => {
    const data = modelDataForHarness(id);
    if (data?.status === 'unsupported') return 'default';
    if (data?.status !== 'available') return '';
    const current = data.currentModel;
    if (
      current &&
      (data.models.length === 0 ||
        data.models.some((model) => model.id === current))
    ) {
      return current;
    }
    return data.models[0]?.id ?? '';
  };
  const [defaultModelId, setDefaultModelId] = createSignal(
    props.agent?.default_model ?? ''
  );
  const selectedDefaultModelId = () =>
    defaultModelId() || preferredModelId(harnessId());
  const selectedModelQuery = () => modelQueryForHarness(harnessId());
  const selectedModelData = () => modelDataForHarness(harnessId());
  const selectedModelOptions = () => {
    const data = selectedModelData();
    if (data?.status !== 'available') return [];

    const selected = selectedDefaultModelId();
    const savedModel =
      props.agent?.default_model === selected &&
      (props.agent.harness_id ?? props.agent.harness) === harnessId();
    if (
      selected.length === 0 ||
      data.models.some((model) => model.id === selected)
    ) {
      return data.models;
    }
    return [
      ...data.models,
      {
        id: selected,
        name: `${selected} (${savedModel ? 'saved, ' : ''}unavailable)`,
        description: undefined,
        group: undefined,
      },
    ];
  };
  const selectedCatalogOptions = () =>
    selectedModelOptions().map((model) => ({
      id: model.id,
      // The built-in runtime reports slugs as names; other runtimes name
      // their own models.
      label:
        harnessId() === IN_MEMORY_HARNESS.id
          ? modelLabel(model.id, model.name)
          : model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const [channelMode, setChannelMode] = createSignal<ChannelMode>(
    props.agent?.channel_scope ?? 'all'
  );
  const [selectedChannelIds, setSelectedChannelIds] = createSignal<string[]>(
    props.agent?.channel_ids ?? []
  );
  const [share, setShare] = createSignal<AgentShare>(
    props.agent?.bot.owner?.type === 'team' ? 'Team' : 'Private'
  );
  const pipedreamMcp = usePipedreamMcpFlag();
  const connections = usePipedreamConnectedSlugs();
  const [mcp, setMcp] = createSignal<AgentMcpServers>(
    props.agent?.mcp ?? { scope: 'owner_connections' }
  );
  const selectedMcpServers = (): AgentMcpServer[] => {
    const current = mcp();
    return current.scope === 'selected' ? current.servers : [];
  };
  // Picks survive a round trip through "Use my connected apps", so toggling
  // the radio to compare does not throw the list away.
  let rememberedMcpServers: AgentMcpServer[] = selectedMcpServers();
  const setMcpScope = (scope: AgentMcpServers['scope']) => {
    if (scope === 'selected') {
      setMcp({ scope: 'selected', servers: rememberedMcpServers });
    } else {
      rememberedMcpServers = selectedMcpServers();
      setMcp({ scope: 'owner_connections' });
    }
  };
  const setSelectedMcpServers = (servers: AgentMcpServer[]) => {
    rememberedMcpServers = servers;
    setMcp({ scope: 'selected', servers });
  };
  const [autoAcceptChoice, setAutoAcceptChoice] = createSignal(
    props.agent?.auto_accept_permissions === true
  );
  const allowPermissionBypass = () =>
    selectedHarness()?.allowPermissionBypass === true;
  const autoAcceptPermissions = () =>
    selectedHarness()?.kind === 'builtin' ||
    (allowPermissionBypass() && autoAcceptChoice());
  // The saved choice, or none: an agent that never chose follows its
  // harness, so a fresh form and a re-picked runtime both start from there.
  const [codingChoice, setCodingChoice] = createSignal<boolean | undefined>(
    props.agent?.is_coding ??
      (props.initialKind ? props.initialKind === 'coder' : undefined)
  );
  const harnessCodes = () => {
    const harness = selectedHarness();
    return isCoderHarness(harness?.kind === 'macrod' ? 'macrod' : harness?.id);
  };
  const isCoding = () => codingChoice() ?? harnessCodes();
  let avatarInputRef: HTMLInputElement | undefined;
  let pageContentRef: HTMLDivElement | undefined;

  const [setup, setSetup] = createSignal<'cursor' | 'pairing'>();
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const cursorHarness = () =>
    props.connectedHarnesses.find((harness) => harness.id === 'cursor');
  const macrodHarnesses = () =>
    props.connectedHarnesses.filter((harness) => harness.kind === 'macrod');
  // Back from a setup guide, land on what was just set up.
  const finishSetup = () => {
    const finished = setup();
    setSetup(undefined);
    const ready =
      finished === 'cursor' ? cursorHarness() : macrodHarnesses()[0];
    if (ready) handleHarnessChange(ready.id);
  };
  const advancedSummary = () =>
    [
      isCoding() ? 'Coding agent' : 'Chat agent',
      channelMode() === 'all'
        ? 'All channels'
        : `${selectedChannelIds().length} ${selectedChannelIds().length === 1 ? 'channel' : 'channels'}`,
      ...(pipedreamMcp()
        ? [
            mcp().scope === 'owner_connections'
              ? 'Your connected apps'
              : `${selectedMcpServers().length} selected apps`,
          ]
        : []),
    ].join(' · ');
  const modelPicker = () => (
    <div class="flex min-w-0 flex-col gap-1.5">
      <span class="text-xs font-medium text-ink-muted">Model</span>
      <Show
        when={selectedModelQuery()}
        fallback={
          <p class="settings-input text-ink-muted">
            Model discovery unavailable
          </p>
        }
        keyed
      >
        {(query) => (
          <Show
            when={!query.isPending}
            fallback={
              <ModelCatalogPicker
                value={null}
                options={[]}
                placeholder="Loading models…"
                onSelect={setDefaultModelId}
                ariaLabel="Default model"
                triggerClass="w-full justify-between"
                pending
              />
            }
          >
            <Show
              when={!query.isError}
              fallback={
                <div class="flex items-center gap-2">
                  <p class="min-w-0 flex-1 text-xs text-negative">
                    Could not load models for{' '}
                    {selectedHarness()?.name ?? 'this runtime'}.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Retry models for ${selectedHarness()?.name ?? 'this runtime'}`}
                    onClick={() =>
                      fireAndForget(query.refetch(), 'agent-settings')
                    }
                  >
                    Retry
                  </Button>
                </div>
              }
            >
              <Show
                when={selectedModelData()?.status === 'available'}
                fallback={
                  <p class="settings-input text-ink-muted">
                    Model selection is unsupported by this runtime.
                  </p>
                }
              >
                <Show
                  when={selectedModelOptions().length > 0}
                  fallback={
                    <p class="settings-input text-ink-muted">
                      This runtime did not return any models.
                    </p>
                  }
                >
                  <ModelCatalogPicker
                    value={selectedDefaultModelId()}
                    options={selectedCatalogOptions()}
                    onSelect={setDefaultModelId}
                    ariaLabel="Default model"
                    triggerClass="w-full justify-between"
                    contentClass="overflow-hidden"
                    placement="bottom-start"
                  />
                </Show>
              </Show>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
  const modelField = () => <div class="max-w-[280px]">{modelPicker()}</div>;

  // An agent that runs in Macro on an Anthropic or OpenAI model can run on
  // its own API key instead of Macro usage. The key is write-only: a saved
  // one shows masked, and is replaced by typing a new one.
  const apiKey = useAgentApiKeyQuery(() => props.agent?.bot.id);
  const [apiKeyDraft, setApiKeyDraft] = createSignal('');
  const [removingApiKey, setRemovingApiKey] = createSignal(false);
  const keyProvider = () =>
    harnessId() === IN_MEMORY_HARNESS.id
      ? apiKeyProviderOf(selectedDefaultModelId())
      : undefined;
  // A new agent has no id yet, so its query stays disabled; read the data
  // only once it has loaded, or the editor would suspend on it.
  const apiKeyData = () => (apiKey.isSuccess ? apiKey.data : undefined);
  const savedApiKey = () =>
    removingApiKey() ? undefined : (apiKeyData()?.key ?? undefined);
  const apiKeyLocked = () => apiKeyData()?.planAllows === false;
  const apiKeyHelp = (provider: ApiKeyProvider) => {
    const saved = savedApiKey();
    if (apiKeyLocked())
      return saved
        ? 'Agent API keys are part of the Premium and Max plans. This agent runs on Macro usage until you upgrade.'
        : 'Agent API keys are part of the Premium and Max plans.';
    if (saved && saved.provider !== provider.id)
      return `The saved ${apiKeyProviderName(saved.provider)} key isn’t used with this model.`;
    return 'Bill usage to your own API key.';
  };
  const apiKeyField = () => (
    <Show when={keyProvider()}>
      {(provider) => (
        <div class="flex max-w-[420px] flex-col gap-1.5">
          <span class="text-xs font-medium text-ink-muted">
            {provider().name} API key
          </span>
          <div class="flex min-w-0 items-center gap-2">
            <ApiKeyInput
              aria-label={`${provider().name} API key`}
              class="flex-1"
              prefix={provider().prefix}
              saved={savedApiKey()?.provider === provider().id}
              disabled={busy() || apiKeyLocked()}
              value={apiKeyDraft()}
              onValueChange={setApiKeyDraft}
            />
            <Show when={savedApiKey()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy()}
                onClick={() => {
                  setApiKeyDraft('');
                  setRemovingApiKey(true);
                }}
              >
                Remove
              </Button>
            </Show>
          </div>
          <p class="text-xs text-ink-extra-muted">{apiKeyHelp(provider())}</p>
        </div>
      )}
    </Show>
  );
  // Saved after the agent, which a new agent needs an id from first.
  const saveApiKey = async (agentId: string) => {
    const draft = apiKeyDraft().trim();
    try {
      if (draft.length > 0 && keyProvider()) {
        await saveAgentApiKey(agentId, draft);
      } else if (removingApiKey()) {
        await removeAgentApiKey(agentId);
      }
    } catch (error) {
      toast.failure(
        `The agent was saved, but not its API key: ${
          error instanceof Error && error.message
            ? error.message
            : 'something went wrong'
        }`
      );
    }
  };

  const close = () => {
    if (!busy()) props.onClose();
  };

  const handleNameInput = (value: string) => {
    setName(value);
    if (!tagEdited()) setTag(slugAgentTag(value));
  };

  const handleHarnessChange = (id: string) => {
    setHarnessId(id);
    setDefaultModelId(preferredModelId(id));
    setAutoAcceptChoice(false);
    setCodingChoice(undefined);
  };

  const handleAvatarInput = async (file: File | undefined) => {
    if (!file || busy()) return;
    setUploadingAvatar(true);
    try {
      setAvatarUrl(await uploadAvatar.mutateAsync(file));
    } catch (error) {
      toast.failure(
        error instanceof Error ? error.message : 'Failed to upload avatar'
      );
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef) avatarInputRef.value = '';
    }
  };

  const canCreate = () =>
    !busy() &&
    name().trim().length > 0 &&
    tag().trim().length > 0 &&
    selectedHarness() !== undefined &&
    selectedDefaultModelId().length > 0 &&
    (channelMode() === 'all' || selectedChannelIds().length > 0) &&
    (mcp().scope === 'owner_connections' || selectedMcpServers().length > 0) &&
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
      // Always sent, flag or no flag, so an editor without the Connections
      // section never wipes a selection somebody else made.
      mcp: mcp(),
      teamId: selectedTeamId(),
      autoAcceptPermissions: autoAcceptPermissions(),
      isCoding: isCoding(),
    });
    if (!saved) return;
    await saveApiKey(saved);
    close();
  };

  return (
    <Switch>
      <Match when={setup() === 'cursor'}>
        <CursorConnectPage onClose={finishSetup} />
      </Match>
      <Match when={setup() === 'pairing'}>
        <RuntimePairingPage onClose={finishSetup} />
      </Match>
      <Match when={!setup()}>
        <SettingsPage
          title={props.agent ? 'Edit agent' : 'New agent'}
          showTitleInSheet
          description="Name it, tell it what to do, and pick where it runs."
          actions={
            <Button variant="ghost" size="sm" onClick={close} disabled={busy()}>
              <ArrowLeftIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />{' '}
              Back
            </Button>
          }
        >
          <section
            aria-label={props.agent ? 'Edit agent' : 'New agent'}
            class="@container"
            ref={pageContentRef}
          >
            <form
              id="agent-form"
              class="flex flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault();
                fireAndForget(submit(), 'agent-settings');
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
                    disabled={busy()}
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
                        whereItRuns: '',
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
                    disabled={busy()}
                    onChange={(event) =>
                      fireAndForget(
                        handleAvatarInput(event.currentTarget.files?.[0]),
                        'agent-settings'
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy()}
                    onClick={() => avatarInputRef?.click()}
                  >
                    <UploadIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
                    {uploadingAvatar() ? 'Uploading…' : 'Upload'}
                  </Button>
                </div>

                <div class="mt-4 grid grid-cols-1 gap-3 @min-[440px]:grid-cols-2">
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
                title="Instructions"
                description="Instructions the agent receives at the start of every conversation."
              >
                <AgentInstructionsEditor
                  markdown={instructions()}
                  onChange={setInstructions}
                  disabled={props.pending}
                  class="rounded-lg border border-edge-muted bg-input px-3 py-2.5 focus-within:border-accent"
                  placeholder="Describe your agent’s role, how it should work, and what a good result looks like…"
                />
              </AgentFormSection>

              <AgentFormSection
                title="Where it runs"
                description="Pick where this agent does its work."
              >
                <fieldset class="flex flex-col gap-2">
                  <legend class="sr-only">Where it runs</legend>
                  <WhereItRunsOption
                    value="in-memory"
                    title="In Macro"
                    description="Fast and built in. Uses Macro tools and your connected apps."
                    icon={<MacroLogo />}
                    checked={harnessId() === IN_MEMORY_HARNESS.id}
                    onSelect={() => handleHarnessChange(IN_MEMORY_HARNESS.id)}
                  >
                    <div class="flex flex-col gap-3">
                      {modelField()}
                      {apiKeyField()}
                    </div>
                  </WhereItRunsOption>
                  <WhereItRunsOption
                    value="cursor"
                    title="In Cursor"
                    description={
                      cursorHarness()
                        ? 'Runs as a Cursor Cloud agent on your Cursor plan.'
                        : 'Connect Cursor first. Runs as a Cursor Cloud agent on your Cursor plan.'
                    }
                    icon={<CursorIcon />}
                    checked={harnessId() === 'cursor'}
                    disabled={!cursorHarness()}
                    action={
                      <Show when={!cursorHarness()}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          class="text-ink"
                          aria-label="Connect Cursor"
                          disabled={busy()}
                          onClick={() => setSetup('cursor')}
                        >
                          Connect
                        </Button>
                      </Show>
                    }
                    onSelect={() => handleHarnessChange('cursor')}
                  >
                    {modelField()}
                  </WhereItRunsOption>
                  <WhereItRunsOption
                    value="harness"
                    title="In your harness"
                    description="Your own agent on your own machine. Local Claude Code, Codex, or other harness, via Macrod."
                    icon={<TerminalIcon />}
                    checked={selectedHarness()?.kind === 'macrod'}
                    disabled={macrodHarnesses().length === 0}
                    action={
                      <Show when={macrodHarnesses().length === 0}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          class="text-ink"
                          aria-label="Set up your own harness"
                          disabled={busy()}
                          onClick={() => setSetup('pairing')}
                        >
                          Set up
                        </Button>
                      </Show>
                    }
                    onSelect={() => {
                      const first = macrodHarnesses()[0];
                      if (first) handleHarnessChange(first.id);
                    }}
                  >
                    <div class="grid grid-cols-1 gap-3 @min-[440px]:grid-cols-[repeat(2,minmax(0,280px))]">
                      <div class="flex min-w-0 flex-col gap-1.5">
                        <span class="text-xs font-medium text-ink-muted">
                          Harness
                        </span>
                        <SettingsSelect
                          label="Harness"
                          options={macrodHarnesses()}
                          value={harnessId()}
                          onChange={handleHarnessChange}
                        />
                      </div>
                      {modelPicker()}
                    </div>
                  </WhereItRunsOption>
                </fieldset>
                <Show when={!keyProvider() ? savedApiKey() : undefined}>
                  {(saved) => (
                    <div class="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
                      <span>
                        This agent has a saved{' '}
                        {apiKeyProviderName(saved().provider)} API key it
                        doesn’t use here.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy()}
                        onClick={() => setRemovingApiKey(true)}
                      >
                        Remove key
                      </Button>
                    </div>
                  )}
                </Show>
              </AgentFormSection>

              <AgentFormSection
                title="Who can use it"
                description="Private agents are yours. Team agents work in shared channels."
              >
                <fieldset class="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-2">
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

              <AgentFormSection
                title="Advanced"
                description={advancedSummary()}
                expanded={advancedOpen()}
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={advancedOpen()}
                    aria-controls="agent-advanced"
                    onClick={() => setAdvancedOpen((open) => !open)}
                  >
                    {advancedOpen() ? 'Hide' : 'Show'}
                  </Button>
                }
              >
                <Show when={advancedOpen()}>
                  <div id="agent-advanced" class="flex flex-col">
                    <fieldset class="grid gap-2">
                      <legend class="text-xs font-medium text-ink">
                        Answering a mention
                      </legend>
                      <ChoiceRow
                        name="agent-coding"
                        value="coding"
                        title="Coding agent"
                        description="Posts a magic chip you can open into the live session and watch it work in a repository."
                        checked={isCoding()}
                        onChange={() => setCodingChoice(true)}
                      />
                      <ChoiceRow
                        name="agent-coding"
                        value="chat"
                        title="Chat agent"
                        description="Replies in the thread the way a person would, like @macro."
                        checked={!isCoding()}
                        onChange={() => setCodingChoice(false)}
                      />
                    </fieldset>
                    <Show when={selectedHarness()?.kind === 'macrod'}>
                      <fieldset class="mt-4 grid gap-2 border-t border-ink/[0.06] pt-4">
                        <legend class="text-xs font-medium text-ink">
                          Permission requests
                        </legend>
                        <ChoiceRow
                          name="agent-permission-policy"
                          value="prompt"
                          title="Always prompt"
                          description="Session editors approve or reject each permission request."
                          checked={!autoAcceptPermissions()}
                          onChange={() => setAutoAcceptChoice(false)}
                        />
                        <Show
                          when={allowPermissionBypass()}
                          fallback={
                            <p class="text-xs text-ink-muted">
                              This runtime requires permission prompts.
                            </p>
                          }
                        >
                          <ChoiceRow
                            name="agent-permission-policy"
                            value="bypass"
                            title="Always bypass"
                            description="Approve tool calls without asking."
                            checked={autoAcceptPermissions()}
                            onChange={() => setAutoAcceptChoice(true)}
                          />
                        </Show>
                      </fieldset>
                    </Show>

                    <Show when={pipedreamMcp()}>
                      <AdvancedGroup
                        title="Connections"
                        description="Which connected apps (MCP tools) this agent can use."
                      >
                        <fieldset class="flex flex-col gap-2">
                          <legend class="sr-only">Connections</legend>
                          <ChoiceRow
                            name="agent-mcp-mode"
                            value="owner_connections"
                            checked={mcp().scope === 'owner_connections'}
                            title="Use my connected apps"
                            description="The agent uses whatever apps the person running it has connected."
                            onChange={() => setMcpScope('owner_connections')}
                          />
                          <ChoiceRow
                            name="agent-mcp-mode"
                            value="selected"
                            checked={mcp().scope === 'selected'}
                            title="Specific apps"
                            description="Pick apps from the catalog. Each person connects their own account."
                            onChange={() => setMcpScope('selected')}
                          />
                        </fieldset>

                        <Show when={mcp().scope === 'selected'}>
                          <div class="mt-3 border-t border-edge-muted pt-3">
                            <PipedreamAppPicker
                              selected={selectedMcpServers()}
                              onChange={setSelectedMcpServers}
                              connectedSlugs={connections.slugs}
                              connectionsReady={connections.ready}
                              connectContainer={() => pageContentRef}
                            />
                          </div>
                        </Show>

                        <Show when={share() === 'Team'}>
                          <p class="mt-3 border-t border-edge-muted pt-3 text-xs text-ink-extra-muted">
                            Connections are personal. Teammates who use this
                            agent connect these apps under Agents → Connections;
                            the indicators here show only your own.
                          </p>
                        </Show>
                      </AdvancedGroup>
                    </Show>

                    <AdvancedGroup
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
                    </AdvancedGroup>
                  </div>
                </Show>
              </AgentFormSection>
            </form>
            <div class="mt-6 flex flex-wrap items-center gap-2 border-t border-edge-muted pt-4">
              <Show when={props.onDelete}>
                {(onDelete) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="text-negative"
                    disabled={busy()}
                    onClick={onDelete()}
                  >
                    <TrashIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />{' '}
                    Delete agent
                  </Button>
                )}
              </Show>
              <div class="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={close}
                  disabled={busy()}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="agent-form"
                  variant="secondary"
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
              </div>
            </div>
          </section>
        </SettingsPage>
      </Match>
    </Switch>
  );
}

function AgentFormSection(props: {
  title: string;
  description: string;
  actions?: JSX.Element;
  expanded?: boolean;
  children: JSX.Element;
}) {
  return (
    <SettingsSection
      title={props.title}
      description={props.description}
      actions={props.actions}
      expanded={props.expanded}
    >
      <div class="pt-2">{props.children}</div>
    </SettingsSection>
  );
}

/** A titled group inside the Advanced section, split by a hairline. */
function AdvancedGroup(props: {
  title: string;
  description: string;
  children: JSX.Element;
}) {
  return (
    <section class="mt-4 border-t border-ink/[0.06] pt-4">
      <h3 class="text-xs font-medium text-ink">{props.title}</h3>
      <p class="mt-0.5 text-xs text-ink-muted">{props.description}</p>
      <div class="mt-2">{props.children}</div>
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
