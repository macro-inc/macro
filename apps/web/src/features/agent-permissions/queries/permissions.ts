import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
  ToolPermissionChange,
} from '@service-agent-harness/tool-permission-types';
import { toolPermissionsClient } from '@service-agent-harness/tool-permissions';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentToolPermissionKeys } from './keys';

/**
 * The routes answer 404 while the feature is off for the caller (or the
 * agent has no permissions to show), which reads as `null`: callers hide
 * the surface rather than showing an error.
 */
async function orUnavailable<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (thrownResultErrorHasCode(error, 'NOT_FOUND')) return null;
    throw error;
  }
}

function fetchCatalog(): Promise<ToolPermissionCatalog | null> {
  return orUnavailable(() => throwOnErr(() => toolPermissionsClient.catalog()));
}

export function toolPermissionCatalogQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: agentToolPermissionKeys.catalog.queryKey,
    queryFn: fetchCatalog,
    enabled,
    // The catalog only changes with a deploy.
    staleTime: 60 * 60_000,
  });
}

export function agentToolPermissionsQueryOptions(
  agentId: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentToolPermissionKeys.agent(agentId).queryKey,
    queryFn: () =>
      orUnavailable(() => throwOnErr(() => toolPermissionsClient.get(agentId))),
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Every group, its tools and the five actions; `null` when unavailable. */
export function useToolPermissionCatalogQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => toolPermissionCatalogQueryOptions(enabled()));
}

/** The agent's resolved permissions; `null` when unavailable. */
export function useAgentToolPermissionsQuery(
  agentId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => agentToolPermissionsQueryOptions(agentId(), enabled()));
}

function storeView(view: AgentToolPermissions) {
  queryClient.setQueryData(
    agentToolPermissionKeys.agent(view.agentId).queryKey,
    view
  );
}

export type SetPermissionsVariables = {
  agentId: string;
  changes: ToolPermissionChange[];
  /** The interaction the change belongs to; context is lost across awaits. */
  trace?: TraceContext;
};

export type ResetPermissionsVariables = {
  agentId: string;
  trace?: TraceContext;
};

function setPermissionsMutationOptions(agentId: string) {
  return {
    // One queue per agent, so clicks reach the server in the order made.
    scope: { id: `agent-tool-permissions:${agentId}` },
    mutationFn: (variables: SetPermissionsVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.set(
          variables.agentId,
          { changes: variables.changes },
          variables.trace
        )
      ),
    onSuccess: storeView,
  };
}

function resetPermissionsMutationOptions(agentId: string) {
  return {
    scope: { id: `agent-tool-permissions:${agentId}` },
    mutationFn: (variables: ResetPermissionsVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.reset(variables.agentId, variables.trace)
      ),
    onSuccess: storeView,
  };
}

export function useSetAgentToolPermissionsMutation(agentId: Accessor<string>) {
  return useMutation(() => setPermissionsMutationOptions(agentId()));
}

export function useResetAgentToolPermissionsMutation(
  agentId: Accessor<string>
) {
  return useMutation(() => resetPermissionsMutationOptions(agentId()));
}
