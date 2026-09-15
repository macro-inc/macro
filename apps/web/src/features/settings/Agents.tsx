import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { claudeCloud } from '@core/constant/featureFlags';
import {
  type AgentKind,
  isCoderHarness,
  kindForHarness,
} from '@app/features/agents-view/core/agent-kind';
import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { toast } from '@core/component/Toast/Toast';
import {
  CURSOR_BOT_HANDLE,
  CURSOR_BOT_ID,
  CURSOR_BOT_NAME,
} from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import {
  MACRO_CODER_BOT_ID,
  MACRO_CODER_HANDLE,
  MACRO_CODER_NAME,
} from '@core/constant/macroCoder';
import { useSettingsState } from '@core/constant/SettingsState';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { ThrownResultError } from '@core/util/result';
import MacroLogo from '@icon/macro-logo.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import CodeIcon from '@phosphor/code.svg';
import GearIcon from '@phosphor/gear.svg';
import HardDrivesIcon from '@phosphor/hard-drives.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import AgentIcon from '@phosphor/sparkle.svg';
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
  type AgentModelTarget,
  buildAgentModelTargets,
  useAgentModelsQueries,
} from '@queries/agents/models';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { useCurrentTeamQuery, useIsTeamOwner } from '@queries/team/teams';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import type { AgentMcpServers } from '@service-storage/generated/schemas/agentMcpServers';
import { useSearchParams } from '@solidjs/router';
import { Avatar, Button, cn, Dialog, Panel, ToggleSwitch } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { botAssignableChannelOptions } from '../channel/Bots/botChannelOptions';
import { canDeleteBot, canManageAgent } from '../channel/Bots/botPermissions';
import { ChannelMultiSelect } from '../channel/Bots/ChannelMultiSelect';
import { HarnessPairingDialog } from './HarnessPairingDialog';
import { HarnessRemoveDialog } from './HarnessRemoveDialog';
import { BYOA_DOCS_URL, lastConnectedText } from './harness-shared';
import { StatusDot } from './integration-ui';
import { PipedreamAppPicker } from './PipedreamAppPicker';
import {
  ChoiceRow,
  IntegrationRow,
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
  kind: AgentKind;
  avatarUrl?: string;
  instructions: string;
  harness: string;
  defaultModel: string;
  channelSummary: string;
  share: AgentShare;
  /** First-party, so it wears a system badge and cannot be edited. */
  system?: boolean;
  persistedAgent?: AgentWithHarnessId;
  editable?: boolean;
};

const KIND_COPY = {
  agent: {
    title: 'Agents',
    description:
      'Create agents with their own identity, instructions, and connections.',
    create: 'Create agent',
  },
  coder: {
    title: 'Coders',
    description:
      'Agents that write code. They take a repository and run on a runtime you configure below.',
    create: 'Create coder',
  },
} as const satisfies Record<AgentKind, Record<string, string>>;

/** The agents that bring your own runtime to Macro through macrod. */
const BYOA_AGENTS = ['Claude Code', 'Codex', 'OpenCode', 'Hermes', 'OpenClaw'];

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

type ConnectedHarness = {
  id: string;
  name: string;
  kind: 'builtin' | 'macrod';
  target: AgentModelTarget;
  connected?: boolean;
};

type ChannelOption = ReturnType<typeof botAssignableChannelOptions>[number];

const IN_MEMORY_HARNESS: ConnectedHarness = {
  id: 'in-memory',
  name: 'In-memory',
  kind: 'builtin',
  target: { harness: 'in-memory' },
};

const MACRO_AGENT: AgentSummary = {
  id: MACRO_AGENT_BOT_ID,
  name: 'Macro',
  tag: 'macro',
  kind: 'agent',
  instructions: '',
  harness: 'In-memory',
  defaultModel: MODEL_PRETTYNAME[Model.sonnet5],
  channelSummary: 'All channels',
  share: 'Team',
  system: true,
};

const MACRO_CODER: AgentSummary = {
  id: MACRO_CODER_BOT_ID,
  name: MACRO_CODER_NAME,
  tag: MACRO_CODER_HANDLE,
  kind: 'coder',
  instructions: '',
  harness: 'Macro sandbox',
  defaultModel: 'Default model',
  channelSummary: 'All channels',
  share: 'Team',
  system: true,
};

function cursorCoder(connected: boolean): AgentSummary {
  return {
    id: CURSOR_BOT_ID,
    name: CURSOR_BOT_NAME,
    tag: CURSOR_BOT_HANDLE,
    kind: 'coder',
    instructions: '',
    harness: connected ? 'Cursor' : 'Cursor · not connected',
    defaultModel: 'Cursor default',
    channelSummary: 'All channels',
    share: 'Team',
    system: true,
  };
}

/** Settings page for viewing and creating persistent agents and coders. */
export function Agents(props: {
  /** Which tab opens first. */
  initialKind?: AgentKind;
  /** Offered as a close control when the page is embedded in a workspace. */
  onClose?: () => void;
}) {
  const claudeCloudFlag = useFeatureFlag(claudeCloud);
  const [kind, setKind] = createSignal<AgentKind>(props.initialKind ?? 'agent');
  const { openSettings } = useSettingsState();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const [pairingDialog, setPairingDialog] = createSignal<{
    initialCode?: string;
  }>();
  const [removingHarness, setRemovingHarness] =
    createSignal<RegisteredHarness>();
  const [creating, setCreating] = createSignal(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const creatingFromLink = () => searchParams.createAgent === 'true';
  const closeCreateAgent = () => {
    setCreating(false);
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
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const harnessesQuery = useHarnessesQuery();
  const connectedHarnesses = (): readonly ConnectedHarness[] => {
    const harnesses = harnessesQuery.isSuccess ? harnessesQuery.data : [];
    return buildAgentModelTargets(
      cursorConnected(),
      harnesses,
      claudeCloudFlag().enabled
    ).map((target) => {
      if (target.harness === 'in-memory') return IN_MEMORY_HARNESS;
      if (target.harness === 'claude-cloud') {
        return {
          id: 'claude-cloud',
          name: 'Claude Cloud',
          kind: 'builtin',
          target,
        };
      }
      if (target.harness === 'cursor') {
        return {
          id: 'cursor',
          name: 'Cursor',
          kind: 'builtin',
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
        target,
        connected: harness?.connected,
      };
    });
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
    canDeleteBot(agent.bot, currentUserId(), currentTeamId(), isTeamOwner());
  const agents = createMemo(() =>
    (agentsQuery.isSuccess ? agentsQuery.data : [])
      .filter((agent) =>
        canManageAgent(agent.bot, currentUserId(), currentTeamId())
      )
      .map((agent) =>
        summarizeAgent(agent, connectedHarnesses(), channelOptions())
      )
  );
  const ofKind = (which: AgentKind, share: AgentShare) =>
    agents().filter((agent) => agent.kind === which && agent.share === share);
  const teamAgents = createMemo(() => [
    MACRO_AGENT,
    ...ofKind('agent', 'Team'),
  ]);
  const privateAgents = createMemo(() => ofKind('agent', 'Private'));
  const teamCoders = createMemo(() => [
    MACRO_CODER,
    cursorCoder(cursorConnected()),
    ...ofKind('coder', 'Team'),
  ]);
  const privateCoders = createMemo(() => ofKind('coder', 'Private'));
  const registeredHarnesses = () =>
    harnessesQuery.isSuccess ? harnessesQuery.data : [];

  const removeHarness = async () => {
    const current = removingHarness();
    if (!current) return;

    try {
      await deleteHarnessMutation.mutateAsync({ harnessId: current.id });
      setRemovingHarness(undefined);
      toast.success('Runtime removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove runtime'));
    }
  };

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

  const list = (rows: AgentSummary[], empty: string) => (
    <AgentList
      agents={rows}
      empty={empty}
      loading={agentsQuery.isPending}
      error={agentsQuery.isError}
      canDelete={canDeleteAgent}
      onEdit={setEditingAgent}
      onDelete={setDeletingAgent}
    />
  );

  return (
    <>
      <SettingsPage
        title={KIND_COPY[kind()].title}
        description={KIND_COPY[kind()].description}
        actions={
          <div class="flex items-center gap-1.5">
            <Button variant="cta" size="sm" onClick={() => setCreating(true)}>
              <PlusIcon />
              {KIND_COPY[kind()].create}
            </Button>
            <Show when={props.onClose}>
              {(onClose) => (
                <Button
                  variant="ghost"
                  size="icon-md"
                  label="Close"
                  onClick={onClose()}
                >
                  <XIcon />
                </Button>
              )}
            </Show>
          </div>
        }
      >
        <div class="flex flex-col gap-8">
          <div class="px-6">
            <KindTabs
              kind={kind()}
              onChange={setKind}
              agents={teamAgents().length + privateAgents().length}
              coders={teamCoders().length + privateCoders().length}
            />
          </div>

          <Show when={kind() === 'agent'}>
            <SettingsSection
              title="Team agents"
              description="Agents shared with your team, including Macro."
            >
              <SettingsCard>
                {list(teamAgents(), 'No team agents yet.')}
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title="Private agents"
              description="Agents owned by you rather than your team."
            >
              <SettingsCard>
                {list(privateAgents(), 'No private agents yet.')}
              </SettingsCard>
            </SettingsSection>
          </Show>

          <Show when={kind() === 'coder'}>
            <SettingsSection
              title="Team coders"
              description="Coders shared with your team, including Macro's own."
            >
              <SettingsCard>
                {list(teamCoders(), 'No team coders yet.')}
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title="Private coders"
              description="Coders owned by you rather than your team."
            >
              <SettingsCard>
                {list(
                  privateCoders(),
                  'No private coders yet. Create one, or pair a runtime below.'
                )}
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title="Runtimes"
              description="Where coders run. Built-in runtimes are always available; paired runtimes come and go with your machine."
            >
              <SettingsCard>
                <IntegrationRow
                  icon={<RuntimeIcon>{<HardDrivesIcon />}</RuntimeIcon>}
                  title={<RuntimeName name="Macro sandbox" badge="system" />}
                  description="Built in · a fresh sandbox in Macro's cloud for every session"
                >
                  <ConnectionLabel connected label="Available" />
                </IntegrationRow>
                <IntegrationRow
                  icon={<RuntimeIcon>{<CursorIcon />}</RuntimeIcon>}
                  title={<RuntimeName name="Cursor" badge="system" />}
                  description={
                    cursorConnected()
                      ? 'Cloud agents · connected with your Cursor API key'
                      : 'Cloud agents · connect with your Cursor API key'
                  }
                >
                  <ConnectionLabel
                    connected={cursorConnected()}
                    label={cursorConnected() ? 'Connected' : 'Not connected'}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    label="Configure Cursor"
                    onClick={() => openSettings('Harness')}
                  >
                    <GearIcon />
                  </Button>
                </IntegrationRow>
                <For each={registeredHarnesses()}>
                  {(harness) => (
                    <IntegrationRow
                      icon={<RuntimeIcon>{<PlugsIcon />}</RuntimeIcon>}
                      title={
                        <RuntimeName
                          name={harness.name}
                          badge={
                            harness.owner.type === 'team' ? 'team' : 'private'
                          }
                        />
                      }
                      description={`macrod · ${lastConnectedText(harness)}`}
                    >
                      <ConnectionLabel
                        connected={harness.connected}
                        label={harness.connected ? 'Connected' : 'Disconnected'}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="text-negative"
                        label={`Remove ${harness.name}`}
                        onClick={() => setRemovingHarness(harness)}
                      >
                        <TrashIcon />
                      </Button>
                    </IntegrationRow>
                  )}
                </For>
                <Show when={harnessesQuery.isError}>
                  <p class="px-6 py-4 text-xs text-negative">
                    Could not load your paired runtimes. Try refreshing this
                    page.
                  </p>
                </Show>
                <BringYourOwnAgent onPair={() => setPairingDialog({})} />
              </SettingsCard>
            </SettingsSection>
          </Show>
        </div>
      </SettingsPage>

      <Show when={pairingDialog()} keyed>
        {(dialog) => (
          <HarnessPairingDialog
            initialCode={dialog.initialCode}
            onClose={() => setPairingDialog(undefined)}
          />
        )}
      </Show>
      <Show when={removingHarness()} keyed>
        {(harness) => (
          <HarnessRemoveDialog
            harnessName={harness.name}
            pending={deleteHarnessMutation.isPending}
            onClose={() => setRemovingHarness(undefined)}
            onConfirm={() => void removeHarness()}
          />
        )}
      </Show>

      <Show when={creating() || creatingFromLink()}>
        <AgentDialog
          initialKind={kind()}
          connectedHarnesses={connectedHarnesses()}
          currentTeamId={currentTeamId()}
          canShareWithTeam={canShareWithTeam()}
          canMakePrivate
          pending={createAgentMutation.isPending}
          onClose={closeCreateAgent}
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
    kind: kindForHarness(agent.harness),
    avatarUrl: agent.bot.avatar_url ?? undefined,
    instructions: agent.instructions,
    harness: harness?.name ?? harnessName(harnessKey),
    defaultModel:
      MODEL_PRETTYNAME[agent.default_model as Model] ?? agent.default_model,
    channelSummary,
    share: agent.bot.owner?.type === 'team' ? 'Team' : 'Private',
    persistedAgent: agent,
    editable: true,
  };
}

function harnessName(id: string): string {
  if (id === 'in-memory') return 'In-memory';
  if (id === 'cursor') return 'Cursor';
  if (id === 'claude-cloud') return 'Claude Cloud';
  // Any other id is a registered macrod harness uuid; if it is not in the
  // connected list any more, the harness has been removed.
  return 'Disconnected harness';
}

function AgentList(props: {
  agents: AgentSummary[];
  empty: string;
  loading: boolean;
  error: boolean;
  canDelete: (agent: AgentWithHarnessId) => boolean;
  onEdit: (agent: AgentWithHarnessId) => void;
  onDelete: (agent: AgentWithHarnessId) => void;
}) {
  return (
    <>
      <Show
        when={props.agents.length > 0}
        fallback={
          <p class="px-6 py-4 text-sm text-ink-muted">
            {props.loading
              ? 'Loading agents…'
              : props.error
                ? 'Your agents are unavailable.'
                : props.empty}
          </p>
        }
      >
        <For each={props.agents}>
          {(agent) => (
            <AgentRow
              agent={agent}
              onEdit={
                agent.editable && agent.persistedAgent
                  ? () =>
                      props.onEdit(agent.persistedAgent as AgentWithHarnessId)
                  : undefined
              }
              onDelete={
                agent.persistedAgent && props.canDelete(agent.persistedAgent)
                  ? () =>
                      props.onDelete(agent.persistedAgent as AgentWithHarnessId)
                  : undefined
              }
            />
          )}
        </For>
      </Show>
      <Show when={props.error}>
        <p class="px-6 py-4 text-xs text-negative">
          Could not load your agents. Try refreshing this page.
        </p>
      </Show>
    </>
  );
}

function KindTabs(props: {
  kind: AgentKind;
  onChange: (kind: AgentKind) => void;
  agents: number;
  coders: number;
}) {
  const tabs = () =>
    [
      { kind: 'agent', label: 'Agents', count: props.agents },
      { kind: 'coder', label: 'Coders', count: props.coders },
    ] as const;
  return (
    <div
      role="tablist"
      aria-label="Agent kind"
      class="flex gap-1 border-b border-edge"
    >
      <For each={tabs()}>
        {(tab) => {
          const selected = () => props.kind === tab.kind;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={selected()}
              class={cn(
                'relative flex h-9 items-center gap-1.5 rounded-t-lg px-2.5 text-[13.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                selected()
                  ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-t after:bg-accent'
                  : 'text-ink-subtle hover:bg-hover hover:text-ink'
              )}
              onClick={() => props.onChange(tab.kind)}
            >
              <Show
                when={tab.kind === 'coder'}
                fallback={<AgentIcon class="size-3.5" />}
              >
                <CodeIcon class="size-3.5" />
              </Show>
              {tab.label}
              <span
                class={cn(
                  'rounded-full bg-active px-1.5 text-[11px] tabular-nums',
                  selected() ? 'text-ink-subtle' : 'text-ink-placeholder'
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function RuntimeIcon(props: { children: JSX.Element }) {
  return (
    <span class="flex size-8 items-center justify-center rounded-lg bg-surface text-ink-muted ring ring-edge-muted [&_svg]:size-4">
      {props.children}
    </span>
  );
}

function RuntimeName(props: {
  name: string;
  badge: 'system' | 'team' | 'private';
}) {
  return (
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate">{props.name}</span>
      <KindBadge label={props.badge} accent={props.badge === 'system'} />
    </span>
  );
}

function KindBadge(props: { label: string; accent?: boolean }) {
  return (
    <span
      class="shrink-0 rounded-full border px-2 py-0.5 text-xxs font-medium uppercase"
      classList={{
        'border-accent/35 bg-accent/8 text-accent': props.accent,
        'border-edge-muted text-ink-extra-muted': !props.accent,
      }}
    >
      {props.label}
    </span>
  );
}

function ConnectionLabel(props: { connected: boolean; label: string }) {
  return (
    <span class="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <StatusDot
        state={props.connected ? 'connected' : 'disconnected'}
        label={props.label}
      />
      {props.label}
    </span>
  );
}

/** Cycles through the coding agents macrod can bring, one name at a time. */
function RotatingAgentName() {
  const [index, setIndex] = createSignal(0);
  onMount(() => {
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % BYOA_AGENTS.length),
      2200
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <span class="text-accent" aria-live="off">
      {BYOA_AGENTS[index()]}
    </span>
  );
}

function BringYourOwnAgent(props: { onPair: () => void }) {
  return (
    <div class="grid grid-cols-[3fr_2fr] items-start gap-5 bg-accent/3 px-6 py-5 mobile:grid-cols-1">
      <div class="min-w-0">
        <h3 class="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
          <PlugsIcon class="size-4 shrink-0 text-accent" />
          <span>
            Bring your <RotatingAgentName /> to Macro
          </span>
        </h3>
        <p class="mt-1.5 max-w-[52ch] text-[13px]/relaxed text-ink-muted">
          Run it on your own machine and give it a seat in Macro. Pair once with
          macrod; after that it can be @mentioned in channels like any other
          agent. Works with any agent that speaks ACP.
        </p>
      </div>
      <div class="flex flex-col gap-1.5">
        <Button
          variant="cta"
          size="sm"
          class="justify-center"
          onClick={props.onPair}
        >
          <PlugsIcon />
          Pair a runtime
        </Button>
        <a
          href={BYOA_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
        >
          Read the macrod guide
          <ArrowUpRightIcon class="size-3.5 opacity-70" />
        </a>
      </div>
    </div>
  );
}

function AgentRow(props: {
  agent: AgentSummary;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div class="flex items-center gap-4 px-6 py-4 mobile:items-start touch:px-4">
      <span class="relative inline-grid shrink-0">
        <AgentAvatar agent={props.agent} />
        <Show when={props.agent.kind === 'coder'}>
          <span
            aria-hidden="true"
            class="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-[5px] bg-accent text-accent-contrast ring-2 ring-surface"
          >
            <CodeIcon class="size-2.5" />
          </span>
        </Show>
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-sm font-medium text-ink">
            {props.agent.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.agent.tag}
          </span>
          <KindBadge
            label={props.agent.system ? 'system' : props.agent.share}
            accent={props.agent.system}
          />
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
              when={
                props.agent.id === MACRO_AGENT_BOT_ID ||
                props.agent.id === MACRO_CODER_BOT_ID
              }
              fallback={
                <Show
                  when={props.agent.id === CURSOR_BOT_ID}
                  fallback={<AgentIcon class="size-5" />}
                >
                  <CursorIcon class="size-5" />
                </Show>
              }
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
  /** What a new agent starts as; an existing one reads it from its harness. */
  initialKind?: AgentKind;
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
  // Coders run on coding runtimes; every other agent runs on the built-in
  // in-memory harness. The kind is not stored: the harness carries it.
  const coderRuntimes = () =>
    props.connectedHarnesses.filter((harness) => harness.id !== 'in-memory');
  const [coder, setCoder] = createSignal(
    props.agent
      ? isCoderHarness(props.agent.harness)
      : props.initialKind === 'coder'
  );
  const noun = () => (coder() ? 'coder' : 'agent');
  const [harnessId, setHarnessId] = createSignal(
    props.agent?.harness_id ??
      props.agent?.harness ??
      (coder() ? coderRuntimes()[0]?.id : 'in-memory') ??
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
      label: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const selectedHarnessUsesCatalog = () =>
    isLargeModelCatalog(selectedCatalogOptions());
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
  let avatarInputRef: HTMLInputElement | undefined;
  let dialogContentRef: HTMLDivElement | undefined;

  const close = () => props.onClose();

  const handleNameInput = (value: string) => {
    setName(value);
    if (!tagEdited()) setTag(slugAgentTag(value));
  };

  const handleHarnessChange = (id: string) => {
    setHarnessId(id);
    setDefaultModelId(preferredModelId(id));
  };

  const setCoderMode = (on: boolean) => {
    setCoder(on);
    handleHarnessChange(on ? (coderRuntimes()[0]?.id ?? '') : 'in-memory');
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
      contentRef={(element) => {
        dialogContentRef = element;
      }}
    >
      <Panel depth={2} class="max-h-[88vh] rounded-xl text-ink">
        <Panel.Header class="justify-between px-3">
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {props.agent ? `Edit ${noun()}` : `Create ${noun()}`}
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
                      kind: coder() ? 'coder' : 'agent',
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
              title="Coder"
              description="Coders write code: they take a repository, run on a coding runtime, and appear under Coders."
            >
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-sm text-ink">
                    {coder() ? 'This is a coder' : 'This is a chat agent'}
                  </div>
                  <div class="mt-0.5 text-xs text-ink-extra-muted">
                    {coderRuntimes().length === 0
                      ? 'Connect Cursor or pair a runtime before making a coder.'
                      : coder()
                        ? "Turn off to run it on Macro's built-in harness instead."
                        : 'Turn on to run it on Cursor or a paired runtime.'}
                  </div>
                </div>
                <ToggleSwitch
                  label="Coder"
                  labelClass="sr-only"
                  size="md"
                  checked={coder()}
                  disabled={coderRuntimes().length === 0 && !coder()}
                  onChange={setCoderMode}
                />
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
              description={
                coder()
                  ? 'Coders run on Cursor or on a machine paired through macrod. Models are limited to what that runtime offers.'
                  : "Agents run on Macro's built-in harness. Pick the model they answer with."
              }
            >
              <Show when={coder()}>
                <fieldset class="mb-3 flex flex-col gap-2">
                  <legend class="sr-only">Runtime</legend>
                  <For
                    each={coderRuntimes()}
                    fallback={
                      <p class="text-xs text-ink-muted">
                        No coding runtime is connected. Connect Cursor or pair a
                        runtime, then come back.
                      </p>
                    }
                  >
                    {(harness) => (
                      <ChoiceRow
                        name="agent-runtime"
                        value={harness.id}
                        checked={harnessId() === harness.id}
                        title={harness.name}
                        description={
                          harness.id === 'cursor'
                            ? 'Cloud agents, run with your Cursor account.'
                            : harness.connected
                              ? 'Paired through macrod · connected'
                              : 'Paired through macrod · disconnected'
                        }
                        onChange={() => handleHarnessChange(harness.id)}
                      />
                    )}
                  </For>
                </fieldset>
              </Show>
              <div class="grid grid-cols-2 gap-3 mobile:grid-cols-1">
                <Show when={!coder()}>
                  <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-ink">Harness</span>
                    <p class="settings-input text-ink-muted">
                      Macro · built in
                    </p>
                  </div>
                </Show>
                <label class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-ink">
                    Default model
                  </span>
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
                          <select
                            aria-label="Default model"
                            class="settings-input w-full"
                            disabled
                          >
                            <option>Loading models…</option>
                          </select>
                        }
                      >
                        <Show
                          when={!query.isError}
                          fallback={
                            <div class="flex items-center gap-2">
                              <p class="min-w-0 flex-1 text-xs text-negative">
                                Could not load models for{' '}
                                {selectedHarness()?.name ?? 'this harness'}.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Retry models for ${selectedHarness()?.name ?? 'this harness'}`}
                                onClick={() => void query.refetch()}
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
                                Model selection is unsupported by this harness.
                              </p>
                            }
                          >
                            <Show
                              when={selectedModelOptions().length > 0}
                              fallback={
                                <p class="settings-input text-ink-muted">
                                  This harness did not return any models.
                                </p>
                              }
                            >
                              <Show
                                when={selectedHarnessUsesCatalog()}
                                fallback={
                                  <select
                                    aria-label="Default model"
                                    class="settings-input w-full"
                                    value={selectedDefaultModelId()}
                                    onChange={(event) =>
                                      setDefaultModelId(
                                        event.currentTarget.value
                                      )
                                    }
                                  >
                                    <For each={selectedModelOptions()}>
                                      {(model) => (
                                        <option value={model.id}>
                                          {model.name}
                                        </option>
                                      )}
                                    </For>
                                  </select>
                                }
                              >
                                <ModelCatalogPicker
                                  value={selectedDefaultModelId()}
                                  options={selectedCatalogOptions()}
                                  onSelect={setDefaultModelId}
                                  ariaLabel="Default model"
                                  triggerClass="w-full justify-between"
                                  contentClass="overflow-hidden"
                                />
                              </Show>
                            </Show>
                          </Show>
                        </Show>
                      </Show>
                    )}
                  </Show>
                </label>
              </div>
            </AgentFormSection>

            <Show when={pipedreamMcp()}>
              <AgentFormSection
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
                      connectContainer={() => dialogContentRef}
                    />
                  </div>
                </Show>

                <Show when={share() === 'Team'}>
                  <p class="mt-3 border-t border-edge-muted pt-3 text-xs text-ink-extra-muted">
                    Connections are personal. Teammates who use this agent
                    connect these apps under Settings → Integrations; the
                    indicators here show only your own.
                  </p>
                </Show>
              </AgentFormSection>
            </Show>

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
                : `Create ${noun()}`}
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
