import HeadCircuit from '@phosphor-icons/core/regular/head-circuit.svg';
import UserGear from '@phosphor-icons/core/regular/user-gear.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { AgentSummary } from '@service-cognition/generated/tools/types';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { type Detail, DetailPanel, ownerLabel } from './Bots';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

const HARNESS_NAMES: Record<string, string> = {
  'in-memory': 'Macro',
  cursor: 'Cursor',
  'claude-cloud': 'Claude Cloud',
  macrod: 'Self-hosted harness',
};

function harnessLabel(agent: AgentSummary): string {
  const name = HARNESS_NAMES[agent.harness] ?? agent.harness;
  return agent.harnessId ? `${name} · ${agent.harnessId}` : name;
}

function channelsLabel(agent: AgentSummary): string {
  if (agent.channelScope === 'all') return 'All channels';
  const count = agent.channelIds.length;
  return `${count} selected channel${count === 1 ? '' : 's'}`;
}

function appsLabel(agent: AgentSummary): string {
  if (agent.mcpScope === 'owner_connections') return "Session owner's apps";
  if (agent.mcpServers.length === 0) return 'None';
  return agent.mcpServers.map((server) => server.serverName).join(', ');
}

function permissionsLabel(agent: AgentSummary): string {
  return agent.autoAcceptPermissions ? 'Approve automatically' : 'Ask first';
}

function agentDetails(agent: AgentSummary): Detail[] {
  return [
    { label: 'Agent ID', value: agent.bot.botId, secret: true },
    { label: 'Handle', value: `@${agent.bot.handle}` },
    { label: 'Owner', value: ownerLabel(agent.bot.owner) },
    { label: 'Runtime', value: harnessLabel(agent) },
    { label: 'Model', value: agent.defaultModel },
    { label: 'Channels', value: channelsLabel(agent) },
    { label: 'Connected apps', value: appsLabel(agent) },
    { label: 'Permissions', value: permissionsLabel(agent) },
    { label: 'Mode', value: agent.isCoding ? 'Coding agent' : 'Chat agent' },
  ];
}

function AgentInstructions(props: { instructions: string }) {
  return (
    <div class="rounded-lg border border-edge-muted bg-ink/[0.02] p-3">
      <p class="mb-2 text-xs text-ink-extra-muted">Instructions</p>
      <Show
        when={props.instructions.trim().length > 0}
        fallback={<p class="text-xs text-ink-muted italic">No instructions</p>}
      >
        <pre class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs text-ink">
          {props.instructions}
        </pre>
      </Show>
    </div>
  );
}

function AgentPanel(props: { agent: AgentSummary; summary?: string }) {
  return (
    <div class="flex flex-col gap-2">
      <DetailPanel
        details={agentDetails(props.agent)}
        summary={props.summary}
      />
      <AgentInstructions instructions={props.agent.instructions} />
    </div>
  );
}

type ListedAgent = NamedTool<
  'ListAgents',
  'response'
>['data']['agents'][number];

function AgentList(props: { agents: ListedAgent[] }) {
  return (
    <Tool.List>
      <div class="max-h-60 overflow-y-auto overscroll-contain">
        <For each={props.agents}>
          {(agent) => (
            <Tool.ListItem icon={<HeadCircuit class="size-4" />}>
              <div class="flex min-w-0 items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-ink">{agent.bot.name}</div>
                  <div class="truncate text-xxs text-ink-extra-muted">
                    @{agent.bot.handle} · {harnessLabel(agent)} ·{' '}
                    {agent.defaultModel}
                  </div>
                </div>
                <span class="max-w-44 shrink-0 truncate text-ink-extra-muted">
                  {agent.isCoding ? 'Coding' : 'Chat'} · {channelsLabel(agent)}
                </span>
              </div>
            </Tool.ListItem>
          )}
        </For>
      </div>
    </Tool.List>
  );
}

const listAgentsHandler = createToolRenderer({
  name: 'ListAgents',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const agents = () => ctx.response?.data.agents ?? [];
    const status = () => {
      if (!ctx.response) return undefined;
      return `${agents().length} agent${agents().length === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        icon={HeadCircuit}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && agents().length > 0 ? (
            <AgentList agents={agents()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>List manageable agents</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={agents().length > 0}
            status={status()}
          />
        </div>
      </BaseTool>
    );
  },
});

const configureAgentHandler = createToolRenderer({
  name: 'ConfigureAgent',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;

    return (
      <BaseTool
        icon={UserGear}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && response() ? (
            <AgentPanel
              agent={response()!.agent}
              summary={response()!.summary}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>{ctx.response ? 'Configured agent' : 'Configure agent'}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!response()}
            status={
              ctx.response
                ? `@${ctx.response.data.agent.bot.handle}`
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

export { configureAgentHandler, listAgentsHandler };
