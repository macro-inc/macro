export type AgentShare = 'Private' | 'Team';

export type AgentRuntime = {
  id: string;
  name: string;
  kind: 'builtin' | 'macrod';
  description: string;
  connected?: boolean;
  teamId?: string;
  target: {
    harness: 'in-memory' | 'cursor' | 'claude-cloud' | 'macrod';
    harnessId?: string;
  };
};

export type AgentApp = { app_slug: string; server_name: string };
export type AgentApps =
  | { scope: 'owner_connections' }
  | { scope: 'selected'; servers: AgentApp[] };

export type AgentDraft = {
  name: string;
  handle: string;
  avatarUrl?: string;
  instructions: string;
  runtimeId: string;
  modelId: string;
  channelScope: 'all' | 'selected';
  channelIds: string[];
  share: AgentShare;
  apps: AgentApps;
};

export type AgentModel = {
  id: string;
  name: string;
  description?: string | null;
  group?: string | null;
};

export type ModelCatalog =
  | { state: 'loading' | 'error' | 'unavailable' }
  | { state: 'unsupported' }
  | { state: 'available'; models: AgentModel[]; currentModel?: string | null };

export function agentHandle(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function runtimeSupportsTeam(
  runtime: AgentRuntime,
  teamId: string | undefined
): boolean {
  return (
    runtime.kind !== 'macrod' ||
    (teamId !== undefined && runtime.teamId === teamId)
  );
}

export function preferredModel(catalog: ModelCatalog): string {
  if (catalog.state === 'unsupported') return 'default';
  if (catalog.state !== 'available') return '';
  if (
    catalog.currentModel &&
    (catalog.models.length === 0 ||
      catalog.models.some((model) => model.id === catalog.currentModel))
  )
    return catalog.currentModel;
  return catalog.models[0]?.id ?? '';
}
