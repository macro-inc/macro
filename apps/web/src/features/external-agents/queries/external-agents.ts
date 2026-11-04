import { createUrqlMutation } from '@app/lib/urql-solid/create-urql-mutation';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  DeleteExternalAgentDocument,
  type ExternalAgentFieldsFragment,
  ExternalAgentsDocument,
  IssueExternalAgentTokenDocument,
  RegisterExternalAgentDocument,
  SetExternalAgentEndpointDocument,
  VerifyExternalAgentEndpointDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import type { ExternalAgent } from '../core/external-agent';

export function toExternalAgent(
  agent: ExternalAgentFieldsFragment
): ExternalAgent {
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatarUrl: agent.avatarUrl ?? undefined,
    teamId: agent.teamId ?? undefined,
    endpoint: agent.endpoint
      ? { url: agent.endpoint.url, verified: agent.endpoint.verified }
      : undefined,
  };
}

/** The message a failed external agent request shows. */
export function externalAgentErrorMessage(
  error: CombinedError | null | undefined
): string | undefined {
  return error?.graphQLErrors[0]?.message ?? error?.message;
}

/** The external agents the viewer may manage. */
export function useExternalAgents() {
  const query = createLiveQuery(
    ExternalAgentsDocument,
    () => ({}),
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
    })
  );
  return {
    agents: (): ExternalAgent[] | undefined =>
      query.data?.user.externalAgents.map(toExternalAgent),
    pending: () => query.isPending,
    error: () => query.error,
    refresh: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

export function useRegisterExternalAgent() {
  return createUrqlMutation(() => ({
    client: getGraphqlSoupClient(),
    mutation: RegisterExternalAgentDocument,
  }));
}

export function useSetExternalAgentEndpoint() {
  return createUrqlMutation(() => ({
    client: getGraphqlSoupClient(),
    mutation: SetExternalAgentEndpointDocument,
  }));
}

export function useVerifyExternalAgentEndpoint() {
  return createUrqlMutation(() => ({
    client: getGraphqlSoupClient(),
    mutation: VerifyExternalAgentEndpointDocument,
  }));
}

export function useIssueExternalAgentToken() {
  return createUrqlMutation(() => ({
    client: getGraphqlSoupClient(),
    mutation: IssueExternalAgentTokenDocument,
  }));
}

export function useDeleteExternalAgent() {
  return createUrqlMutation(() => ({
    client: getGraphqlSoupClient(),
    mutation: DeleteExternalAgentDocument,
  }));
}
