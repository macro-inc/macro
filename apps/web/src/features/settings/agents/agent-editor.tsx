import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import type {
  AgentWithHarnessId,
  CreateAgentParams,
} from '@queries/agents/agents';
import { useAgentModelsQueries } from '@queries/agents/models';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { Suspense } from 'solid-js';
import { ChannelMultiSelect } from '../../channel/Bots/ChannelMultiSelect';
import { PipedreamAppPicker } from '../PipedreamAppPicker';
import type { AgentEditorSource } from './context/editor-source';
import type { AgentDraft, AgentRuntime, ModelCatalog } from './core/types';
import { AgentEditorView } from './views/agent-editor';

/** Settings owns production queries; the editor receives only its capabilities. */
export function AgentEditor(props: {
  agent?: AgentWithHarnessId;
  runtimes: readonly AgentRuntime[];
  currentTeamId?: string;
  canShareWithTeam: boolean;
  canMakePrivate: boolean;
  pending: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | undefined;
  onSave: (agent: CreateAgentParams) => Promise<boolean>;
}) {
  const models = useAgentModelsQueries(() =>
    props.runtimes.map((runtime) => runtime.target)
  );
  const modelQuery = (id: string) => {
    const index = props.runtimes.findIndex((runtime) => runtime.id === id);
    return index < 0 ? undefined : models[index];
  };
  const catalog = (id: string): ModelCatalog => {
    const query = modelQuery(id);
    if (!query) return { state: 'unavailable' };
    if (query.isPending) return { state: 'loading' };
    if (query.isError) return { state: 'error' };
    const data = query.isSuccess ? query.data : undefined;
    if (!data) return { state: 'loading' };
    return data.status === 'unsupported'
      ? { state: 'unsupported' }
      : {
          state: 'available',
          models: data.models,
          currentModel: data.currentModel,
        };
  };
  const appsEnabled = usePipedreamMcpFlag();
  const connections = usePipedreamConnectedSlugs();
  const teamId = () =>
    props.agent?.bot.owner?.type === 'team'
      ? props.agent.bot.owner.team_id
      : props.currentTeamId;
  const source: AgentEditorSource = {
    runtimes: () => props.runtimes,
    catalog,
    retryModels: async (id) => {
      await modelQuery(id)?.refetch();
    },
    pending: () => props.pending,
    canShareWithTeam: () => props.canShareWithTeam,
    canMakePrivate: () => props.canMakePrivate,
    teamId,
    save: async (draft) => {
      const runtime = props.runtimes.find(
        (runtime) => runtime.id === draft.runtimeId
      );
      if (!runtime) return false;
      return props.onSave({
        name: draft.name,
        handle: draft.handle,
        avatarUrl: draft.avatarUrl,
        instructions: draft.instructions,
        defaultModel: draft.modelId,
        harness: runtime.target.harness,
        harnessId: runtime.target.harnessId,
        channelScope: draft.channelScope,
        channelIds: draft.channelScope === 'all' ? [] : draft.channelIds,
        mcp: draft.apps,
        teamId: draft.share === 'Team' ? teamId() : undefined,
      });
    },
  };
  const initial: AgentDraft = {
    name: props.agent?.bot.name ?? '',
    handle: props.agent?.bot.handle ?? '',
    avatarUrl: props.agent?.bot.avatar_url ?? undefined,
    instructions: props.agent?.instructions ?? '',
    runtimeId: props.agent?.harness_id ?? props.agent?.harness ?? 'in-memory',
    modelId: props.agent?.default_model ?? '',
    channelScope: props.agent?.channel_scope ?? 'all',
    channelIds: props.agent?.channel_ids ?? [],
    share: props.agent?.bot.owner?.type === 'team' ? 'Team' : 'Private',
    apps: props.agent?.mcp ?? { scope: 'owner_connections' },
  };
  return (
    <AgentEditorView
      initial={initial}
      editing={!!props.agent}
      source={source}
      appsEnabled={appsEnabled()}
      onClose={props.onClose}
      returnFocus={props.returnFocus}
      renderApps={(servers, onChange, container) => (
        <Suspense
          fallback={
            <p class="text-xs text-ink-muted">Loading connected apps…</p>
          }
        >
          <PipedreamAppPicker
            selected={servers()}
            onChange={onChange}
            connectedSlugs={connections.slugs}
            connectionsReady={connections.ready}
            connectContainer={container}
          />
        </Suspense>
      )}
      renderChannels={(ids, onChange) => (
        <Suspense
          fallback={<p class="text-xs text-ink-muted">Loading channels…</p>}
        >
          <ChannelMultiSelect channelIds={ids()} onChange={onChange} />
        </Suspense>
      )}
    />
  );
}
