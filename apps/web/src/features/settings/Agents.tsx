import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { toast } from '@core/component/Toast/Toast';
import { claudeCloud } from '@core/constant/featureFlags';
import {
  MACRO_AGENT_BOT_ID,
  MACRO_HARNESS_NAME,
} from '@core/constant/macroAgent';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import MacroLogo from '@icon/macro-logo.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import TrashIcon from '@phosphor/trash.svg';
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
import { useCurrentTeamQuery, useIsTeamOwner } from '@queries/team/teams';
import { useSearchParams } from '@solidjs/router';
import { Avatar, Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { botAssignableChannelOptions } from '../channel/Bots/botChannelOptions';
import { canDeleteBot, canManageAgent } from '../channel/Bots/botPermissions';
import { AgentEditor } from './agents/agent-editor';
import { agentInstructionsPreview } from './agents/core/instructions-preview';
import type { AgentRuntime, AgentShare } from './agents/core/types';
import { Harness } from './Harness';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

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

type ChannelOption = ReturnType<typeof botAssignableChannelOptions>[number];

const IN_MEMORY_HARNESS: AgentRuntime = {
  id: 'in-memory',
  name: MACRO_HARNESS_NAME,
  description: 'Built in · works with your Macro workspace',
  kind: 'builtin',
  allowPermissionBypass: true,
  target: { harness: 'in-memory' },
};

const MACRO_AGENT: AgentSummary = {
  id: MACRO_AGENT_BOT_ID,
  name: 'Macro',
  tag: 'macro',
  instructions: '',
  harness: MACRO_HARNESS_NAME,
  defaultModel: MODEL_PRETTYNAME[Model.sonnet5],
  channelSummary: 'All channels',
  share: 'Team',
};

/** Settings page for viewing and creating persistent agents. */
export function Agents() {
  const claudeCloudFlag = useFeatureFlag(claudeCloud);
  const [creating, setCreating] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [searchParams, setSearchParams] = useSearchParams();
  const creatingFromLink = () => searchParams.createAgent === 'true';
  const closeCreateAgent = () => {
    setCreating(false);
    if (creatingFromLink()) {
      setSearchParams({ createAgent: undefined }, { replace: true });
    }
  };
  const [editingAgent, setEditingAgent] = createSignal<AgentWithHarnessId>();
  let editorTrigger: HTMLElement | undefined;
  const rememberEditorTrigger = () => {
    editorTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
  };
  const openCreateAgent = () => {
    rememberEditorTrigger();
    setCreating(true);
  };
  const openEditAgent = (agent: AgentWithHarnessId | undefined) => {
    if (!agent) return;
    rememberEditorTrigger();
    setEditingAgent(agent);
  };
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
  const connectedHarnesses = (): readonly AgentRuntime[] => {
    const harnesses = harnessesQuery.isSuccess ? harnessesQuery.data : [];
    return buildAgentModelTargets(
      cursorConnected(),
      harnesses,
      claudeCloudFlag().enabled
    ).map((modelTarget) => {
      const target = {
        ...modelTarget,
        harnessId: modelTarget.harnessId ?? undefined,
      };
      if (target.harness === 'in-memory') return IN_MEMORY_HARNESS;
      if (target.harness === 'claude-cloud') {
        return {
          id: 'claude-cloud',
          name: 'Claude Cloud',
          description: 'Cloud · your Claude subscription',
          kind: 'builtin',
          allowPermissionBypass: true,
          target,
        };
      }
      if (target.harness === 'cursor') {
        return {
          id: 'cursor',
          name: 'Cursor',
          description: 'Cloud · your Cursor account',
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
        description:
          harness?.owner.type === 'team' ? 'Team computer' : 'Your computer',
        teamId:
          harness?.owner.type === 'team' ? harness.owner.team_id : undefined,
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
  const matchesSearch = (agent: AgentSummary) =>
    `${agent.name} ${agent.tag} ${agent.instructions}`
      .toLowerCase()
      .includes(search().trim().toLowerCase());
  const teamAgents = createMemo(() =>
    [MACRO_AGENT, ...agents().filter((agent) => agent.share === 'Team')].filter(
      matchesSearch
    )
  );
  const privateAgents = createMemo(() =>
    agents().filter(
      (agent) => agent.share === 'Private' && matchesSearch(agent)
    )
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
        title="Agents & runtimes"
        description="Create assistants for your work, and choose where they run."
        actions={
          <Button variant="cta" size="sm" onClick={openCreateAgent}>
            <PlusIcon />
            Create agent
          </Button>
        }
      >
        <label class="flex items-center gap-2 rounded-lg border border-edge-muted bg-input px-3 focus-within:ring-2 focus-within:ring-accent/20">
          <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-muted" />
          <input
            type="search"
            aria-label="Search agents"
            placeholder="Search your agents…"
            class="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <SettingsSection
          title="Team agents"
          description="Shared assistants your team can work with."
        >
          <SettingsCard class="border-edge-muted">
            <For
              each={teamAgents()}
              fallback={
                <p class="px-6 py-4 text-sm text-ink-muted">
                  No team agents match your search.
                </p>
              }
            >
              {(agent) => (
                <AgentRow
                  agent={agent}
                  onEdit={
                    agent.editable && agent.persistedAgent
                      ? () => openEditAgent(agent.persistedAgent)
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
          description="Agents you manage, ready for your next conversation."
        >
          <SettingsCard class="border-edge-muted">
            <Show
              when={privateAgents().length > 0}
              fallback={
                <div class="px-6 py-6">
                  <p class="text-sm text-ink-muted">
                    {agentsQuery.isPending
                      ? 'Loading agents…'
                      : agentsQuery.isError
                        ? 'Your agents are unavailable.'
                        : search().trim()
                          ? 'No private agents match your search.'
                          : 'Your next teammate starts here.'}
                  </p>
                  <Show
                    when={
                      !agentsQuery.isPending &&
                      !agentsQuery.isError &&
                      !search().trim()
                    }
                  >
                    <p class="mt-1 text-xs leading-5 text-ink-muted">
                      A research partner, a writing assistant, a code reviewer.
                      Give an agent a job and instructions it can use again and
                      again.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      class="mt-4"
                      onClick={openCreateAgent}
                    >
                      <PlusIcon />
                      Create your first agent
                    </Button>
                  </Show>
                </div>
              }
            >
              <For each={privateAgents()}>
                {(agent) => (
                  <AgentRow
                    agent={agent}
                    onEdit={
                      agent.editable && agent.persistedAgent
                        ? () => openEditAgent(agent.persistedAgent)
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
        <Harness />
      </SettingsPage>

      <Show when={creating() || creatingFromLink()}>
        <AgentEditor
          returnFocus={() => editorTrigger}
          runtimes={connectedHarnesses()}
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
          <AgentEditor
            returnFocus={() => editorTrigger}
            agent={agent}
            runtimes={connectedHarnesses()}
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
  harnesses: readonly AgentRuntime[],
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
  if (id === 'in-memory') return MACRO_HARNESS_NAME;
  if (id === 'cursor') return 'Cursor';
  if (id === 'claude-cloud') return 'Claude Cloud';
  // Any other id is a registered macrod harness uuid; if it is not in the
  // connected list any more, the harness has been removed.
  return 'Unavailable runtime';
}

function AgentRow(props: {
  agent: AgentSummary;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const instructionsPreview = createMemo(() =>
    agentInstructionsPreview(props.agent.instructions)
  );
  return (
    <div class="group flex items-center gap-4 px-6 py-4 mobile:items-start touch:px-4">
      <AgentAvatar agent={props.agent} />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-sm font-medium text-ink">
            {props.agent.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.agent.tag}
          </span>
          <span
            class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            classList={{
              'border-accent/20 bg-accent/5 text-accent':
                props.agent.id === MACRO_AGENT_BOT_ID,
              'border-edge-muted bg-ink/5 text-ink-muted':
                props.agent.id !== MACRO_AGENT_BOT_ID,
            }}
          >
            {props.agent.id === MACRO_AGENT_BOT_ID
              ? 'System'
              : props.agent.share}
          </span>
        </div>
        <Show
          when={instructionsPreview() || props.agent.id === MACRO_AGENT_BOT_ID}
        >
          <p class="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">
            {instructionsPreview() ||
              'Your everyday assistant for work in Macro.'}
          </p>
        </Show>
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
              size="sm"
              aria-label={`Edit ${props.agent.name}`}
              onClick={onEdit()}
            >
              <PencilIcon />
              <span class="mobile:sr-only">Edit</span>
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
