import { throwOnErr } from '@core/util/result';
import type { TraceContext } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type { ToolPermissionChange } from '@service-agent-harness/generated/schemas';
import { toolPermissionsClient } from '@service-agent-harness/tool-permissions';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { agentToolPermissionKeys } from './keys';
import { orUnavailable, storeView } from './permissions';
import type { ReferencesView, SourceCandidate } from './references-view';

/** Which candidates to list: an agent's, or a new agent's by its scope. */
export type SourceQuery = {
  agentId?: string;
  scope?: 'private' | 'team';
  teamId?: string;
};

export function sourceCandidatesQueryOptions(
  query: SourceQuery,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentToolPermissionKeys.sources(query).queryKey,
    queryFn: () =>
      orUnavailable(() =>
        throwOnErr(() =>
          toolPermissionsClient.sources<SourceCandidate[]>(query)
        )
      ),
    enabled,
  });
}

export function policyViewQueryOptions(
  policyId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: agentToolPermissionKeys.policy(policyId ?? '').queryKey,
    queryFn: () =>
      orUnavailable(() =>
        throwOnErr(() =>
          toolPermissionsClient.policy<ReferencesView>(policyId ?? '')
        )
      ),
    enabled: enabled && policyId !== undefined,
  });
}

/** The policies an agent may follow, in the server's order; `null` when unavailable. */
export function useSourceCandidatesQuery(
  query: Accessor<SourceQuery>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => sourceCandidatesQueryOptions(query(), enabled()));
}

/** A policy's resolved permissions (a source's preview); `null` when unavailable. */
export function usePolicyViewQuery(
  policyId: Accessor<string | undefined>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => policyViewQueryOptions(policyId(), enabled()));
}

export type SetSourceVariables = {
  agentId: string;
  sourcePolicyId: string;
  trace?: TraceContext;
};

export type DetachVariables = {
  agentId: string;
  changes?: ToolPermissionChange[];
  trace?: TraceContext;
};

/** A source change also changes what the agent's candidates say. */
function storeSourceView(view: ReferencesView) {
  queryClient.invalidateQueries({
    queryKey: agentToolPermissionKeys.sources._def,
  });
  return storeView(view);
}

function setSourceMutationOptions(agentId: string) {
  return {
    // The same queue as the agent's other saves, so they land in order.
    scope: { id: `agent-tool-permissions:${agentId}` },
    onMutate: () =>
      queryClient.cancelQueries({
        queryKey: agentToolPermissionKeys.agent(agentId).queryKey,
      }),
    mutationFn: (variables: SetSourceVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.setSource<ReferencesView>(
          variables.agentId,
          { sourcePolicyId: variables.sourcePolicyId },
          variables.trace
        )
      ),
    onSuccess: storeSourceView,
  };
}

function detachMutationOptions(agentId: string) {
  return {
    scope: { id: `agent-tool-permissions:${agentId}` },
    onMutate: () =>
      queryClient.cancelQueries({
        queryKey: agentToolPermissionKeys.agent(agentId).queryKey,
      }),
    mutationFn: (variables: DetachVariables) =>
      throwOnErr(() =>
        toolPermissionsClient.detach<ReferencesView>(
          variables.agentId,
          variables.changes ? { changes: variables.changes } : {},
          variables.trace
        )
      ),
    onSuccess: storeSourceView,
  };
}

export function useSetSourceMutation(agentId: Accessor<string>) {
  return useMutation(() => setSourceMutationOptions(agentId()));
}

export function useDetachMutation(agentId: Accessor<string>) {
  return useMutation(() => detachMutationOptions(agentId()));
}

/**
 * For a new agent, whose id isn't known when the form mounts: the same
 * requests as the mutations, run once it exists.
 */
export async function setSourceNow(variables: SetSourceVariables) {
  const options = setSourceMutationOptions(variables.agentId);
  const view = await options.mutationFn(variables);
  await options.onSuccess(view);
  return view;
}

export async function detachNow(variables: DetachVariables) {
  const options = detachMutationOptions(variables.agentId);
  const view = await options.mutationFn(variables);
  await options.onSuccess(view);
  return view;
}
