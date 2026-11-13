import { fireAndForget } from '@core/util/fireAndForget';
import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import type { PasswordAgentRevokeScope } from '@service-storage/generated/schemas/passwordAgentRevokeScope';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import type { Result } from 'neverthrow';
import { createSignal } from 'solid-js';
import { usePasswords } from '../context/passwords-context';
import type { AgentRequestDecision } from '../core/types';
import {
  type AgentRequestFailure,
  type AgentRequestSource,
  agentRequestsQueryOptions,
} from '../queries/agent-requests';
import { passwordKeys } from '../queries/keys';

/**
 * Review state for one item's agents. Until the list loads there are no rows,
 * so a reviewer's item never waits on, or suspends for, its agent list.
 */
export function createAgentRequests(
  source: AgentRequestSource,
  itemId: () => string
) {
  const { scope, displayName } = usePasswords();
  const queryClient = useQueryClient();
  const key = () => passwordKeys.agentRequests(scope.key, itemId()).queryKey;
  const states = useQuery(() =>
    agentRequestsQueryOptions(scope.key, source, itemId())
  );
  const [busy, setBusy] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const pending = () =>
    states.isPending || (stale() && (busy() || states.isFetching));
  /** Agents waiting for, or holding, access, only after a successful current read. */
  const shown = (): PasswordAgentAccessRequestState[] =>
    states.isSuccess && !pending()
      ? states.data.filter(
          (state) =>
            state.status === 'pending' || state.access.useBasis !== null
        )
      : [];

  async function settle(
    work: () => Promise<Result<unknown, AgentRequestFailure>>
  ) {
    if (busy() || states.isFetching || !states.isSuccess) return;
    setBusy(true);
    setStale(false);
    setFailed(false);
    const result = await work();
    if (result.isErr()) {
      if (result.error === 'stale') setStale(true);
      else setFailed(true);
    }
    await queryClient.invalidateQueries({ queryKey: key() });
    setBusy(false);
  }
  const resolve = (
    state: PasswordAgentAccessRequestState,
    decision: AgentRequestDecision
  ) => {
    const requestId = state.requestId;
    if (!requestId) return;
    fireAndForget(
      settle(() =>
        source.resolve(
          itemId(),
          requestId,
          decision === 'deny'
            ? { decision: 'deny', revision: state.revision }
            : {
                decision: 'approve',
                revision: state.revision,
                permission: decision,
              }
        )
      ),
      'passwords-agent-requests'
    );
  };
  const revoke = (
    state: PasswordAgentAccessRequestState,
    revokeScope: PasswordAgentRevokeScope
  ) =>
    fireAndForget(
      settle(() =>
        source.revoke(itemId(), state.agentAccountId, {
          expectedPermissionRevision: state.access.permissionRevision,
          scope: revokeScope,
        })
      ),
      'passwords-agent-requests'
    );

  return {
    shown,
    nameOf: displayName,
    busy: () => busy() || states.isFetching,
    pending,
    error: () => states.isError,
    retry: () =>
      fireAndForget(states.refetch(), 'passwords-agent-requests-retry'),
    stale: () => stale() && states.isSuccess && !busy() && !states.isFetching,
    failed,
    resolve,
    revoke,
  };
}
