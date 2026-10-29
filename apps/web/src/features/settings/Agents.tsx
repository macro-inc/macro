import { useOpenAgentDm } from '@app/features/agent-dms/open-agent-dm';
import type { AgentKind } from '@app/features/agents-view/core/agent-kind';
import { AGENTS_TOUR } from '@app/features/agents-view/tour';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { toast } from '@core/component/Toast/Toast';
import {
  CURSOR_BOT_HANDLE,
  CURSOR_BOT_ID,
  CURSOR_BOT_NAME,
} from '@core/constant/cursorAgent';
import { ENABLE_AGENT_DMS } from '@core/constant/featureFlags';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { MACRO_NEW_BOT_ID } from '@core/constant/macroNew';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import {
  type AgentWithHarnessId,
  type CreateAgentParams,
  useAgentsQuery,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from '@queries/agents/agents';
import { buildAgentModelTargets } from '@queries/agents/models';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import {
  useCurrentTeamQuery,
  useIsTeamAdmin,
  useIsTeamOwner,
} from '@queries/team/teams';
import { useSearchParams } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { botAssignableChannelOptions } from '../channel/Bots/botChannelOptions';
import { canDeleteBot, canManageAgent } from '../channel/Bots/botPermissions';
import { AgentRuntimes } from './AgentRuntimes';
import { AgentEditorPage } from './agent-editor-page';
import {
  agentSettingsRequest,
  consumeAgentSettingsRequest,
} from './agentSettingsState';
import { AgentAvatar } from './components/agent-avatar';
import { CodingPreferencesSetting } from './components/coding-preferences-setting';
import {
  type AgentSummary,
  type ConnectedHarness,
  IN_MEMORY_HARNESS,
} from './core/agent-settings';
import { SettingsCard, SettingsPage, SettingsSurface } from './primitives';

type ChannelOption = ReturnType<typeof botAssignableChannelOptions>[number];

/** The first-party Cursor agent, mentioned as @Cursor once it is added. */
const CURSOR_AGENT: AgentSummary = {
  id: CURSOR_BOT_ID,
  name: CURSOR_BOT_NAME,
  tag: CURSOR_BOT_HANDLE,
  instructions: '',
  whereItRuns: 'Cursor Cloud',
  defaultModel: '',
  channelSummary: 'All channels',
  share: 'Team',
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
  /** Adds Cursor, or manages it once it is connected. */
  onCursor: () => void;
  onNewRuntime: () => void;
  /** Scrolls the Runtimes section into view, then reports it did. */
  focusRuntimes?: boolean;
  onRuntimesFocused?: () => void;
}) {
  const agentDm = ENABLE_AGENT_DMS ? useOpenAgentDm() : undefined;
  const messageAgent = (id: string) =>
    agentDm?.open(id === MACRO_AGENT_BOT_ID ? MACRO_NEW_BOT_ID : id);
  const agentList = tourTarget(AGENTS_TOUR.agentList);
  let runtimes: HTMLDivElement | undefined;
  // Runtimes links and finished pairings land on the Runtimes section.
  createEffect(
    on(
      () => props.focusRuntimes,
      (focus) => {
        if (!focus || !runtimes) return;
        runtimes.scrollIntoView({ block: 'start' });
        props.onRuntimesFocused?.();
      }
    )
  );
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
  const teamAgents = createMemo(() =>
    agents().filter((agent) => agent.share === 'Team')
  );
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
                <AgentRow
                  agent={MACRO_AGENT}
                  onMessage={
                    agentDm
                      ? () =>
                          fireAndForget(
                            messageAgent(MACRO_AGENT.id),
                            'agent-settings'
                          )
                      : undefined
                  }
                  messagePending={agentDm?.pending()}
                />
                <AgentRow
                  agent={CURSOR_AGENT}
                  badge={false}
                  subtitle={
                    cursorConnected()
                      ? 'Cursor Cloud agents on your Cursor plan · All channels'
                      : 'Hands coding work to a Cursor Cloud agent. Add your Cursor API key to mention it.'
                  }
                  actions={
                    <Show when={cursorStatus.isSuccess}>
                      <Show
                        when={cursorConnected()}
                        fallback={
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label="Add Cursor"
                            onClick={props.onCursor}
                          >
                            <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
                            Add
                          </Button>
                        }
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Manage Cursor"
                          onClick={props.onCursor}
                        >
                          Manage
                        </Button>
                      </Show>
                    </Show>
                  }
                />
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
          <div ref={runtimes}>
            <AgentRuntimes onNewRuntime={props.onNewRuntime} />
          </div>
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
          onMessage={
            agentDm
              ? (agentId) => {
                  closeCreateAgent();
                  fireAndForget(messageAgent(agentId), 'agent-settings');
                }
              : undefined
          }
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
  /** Replaces the Team/Private pill; `false` shows none. */
  badge?: string | false;
  /** Replaces the where-it-runs, model, and channels line. */
  subtitle?: string;
  /** Replaces Message, Edit, and Delete. */
  actions?: JSX.Element;
  onEdit?: () => void;
  onDelete?: () => void;
  onMessage?: () => void;
  messagePending?: boolean;
}) {
  return (
    <div class="flex items-center gap-4 px-6 py-4 mobile:items-start touch:px-4">
      <AgentAvatar
        id={props.agent.id}
        name={props.agent.name}
        tag={props.agent.tag}
        avatarUrl={props.agent.avatarUrl}
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-sm font-medium text-ink">
            {props.agent.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.agent.tag}
          </span>
          <Show when={props.badge !== false}>
            <span class="shrink-0 rounded-full border border-edge-muted px-2 py-0.5 text-xxs font-medium uppercase text-ink-extra-muted">
              {props.badge || props.agent.share}
            </span>
          </Show>
        </div>
        <p class="mt-0.5 text-xs text-ink-extra-muted">
          {props.subtitle ??
            `${props.agent.whereItRuns} · ${props.agent.defaultModel} · ${props.agent.channelSummary}`}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        {props.actions}
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
