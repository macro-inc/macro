import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { invalidateGithubLinkStatus } from '@queries/auth/github-link';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  AddServerRequest,
  Connector,
} from '@service-cognition/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import {
  dropConnector,
  GITHUB_CONNECTOR_KEY,
  invalidateConnectors,
  patchConnector,
  restoreConnectors,
  upsertConnector,
} from './connectors';

type UpdateVariables = { key: string; enabled?: boolean; name?: string };
type Snapshot = { previous: Connector[] | undefined };

async function updateConnector(variables: UpdateVariables) {
  await throwOnErr(
    async () => await cognitionApiServiceClient.updateConnector(variables)
  );
}

function applyUpdate(variables: UpdateVariables): Snapshot {
  return {
    previous: patchConnector(variables.key, (connector) => ({
      ...connector,
      name: variables.name ?? connector.name,
      // Turning a connection on or off moves only between these two; the
      // server's answer settles anything else on the refetch.
      status:
        variables.enabled === undefined ||
        (connector.status !== 'connected' && connector.status !== 'disabled')
          ? connector.status
          : variables.enabled
            ? 'connected'
            : 'disabled',
    })),
  };
}

function rollback(
  _error: unknown,
  _variables: unknown,
  context: Snapshot | undefined
) {
  if (context) restoreConnectors(context.previous);
}

/** Turn a connection on or off, or rename it. */
export function useUpdateConnectorMutation() {
  return useMutation(() => ({
    mutationFn: updateConnector,
    onMutate: applyUpdate,
    onError: rollback,
    onSettled: invalidateConnectors,
  }));
}

async function removeConnector(variables: { key: string }) {
  await throwOnErr(
    async () => await cognitionApiServiceClient.removeConnector(variables)
  );
}

function applyRemove(variables: { key: string }): Snapshot {
  return { previous: dropConnector(variables.key) };
}

async function settleRemove(
  _result: unknown,
  _error: unknown,
  variables: { key: string }
) {
  // Removing GitHub unlinks the account, which pull request features and
  // the pull requests listed everywhere read.
  if (variables.key === GITHUB_CONNECTOR_KEY) {
    fireAndForget(invalidateGithubLinkStatus(), 'connectors');
    invalidateAllSoup();
  }
  await invalidateConnectors();
}

/** Remove a connection. Removing GitHub unlinks the Macro GitHub account. */
export function useRemoveConnectorMutation() {
  return useMutation(() => ({
    mutationFn: removeConnector,
    onMutate: applyRemove,
    onError: rollback,
    onSettled: settleRemove,
  }));
}

async function addServer(request: AddServerRequest) {
  return await throwOnErr(
    async () => await cognitionApiServiceClient.addConnectorServer(request)
  );
}

async function settleAdd(connector: Connector) {
  upsertConnector(connector);
  await invalidateConnectors();
}

/** Add a server by URL. One at an app's address comes back as that app. */
export function useAddConnectorServerMutation() {
  return useMutation(() => ({
    mutationFn: addServer,
    onSuccess: settleAdd,
  }));
}
