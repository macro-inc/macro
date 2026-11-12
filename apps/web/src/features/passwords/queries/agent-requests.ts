import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import type { PasswordAgentAccessRequestPage } from '@service-storage/generated/schemas/passwordAgentAccessRequestPage';
import type { PasswordAgentAccessRequestState } from '@service-storage/generated/schemas/passwordAgentAccessRequestState';
import type { PasswordAgentItemAccess } from '@service-storage/generated/schemas/passwordAgentItemAccess';
import type { PasswordAgentResolveRequest } from '@service-storage/generated/schemas/passwordAgentResolveRequest';
import type { PasswordAgentRevokeBody } from '@service-storage/generated/schemas/passwordAgentRevokeBody';
import { queryOptions } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { passwordKeys } from './keys';
import type { PasswordSourceScope } from './source';

/**
 * `unavailable`: the agent vault is off for this team or the item is gone, so
 * nothing is shown. `stale`: the request or grant changed since it was read.
 */
export type AgentRequestFailure =
  | 'unavailable'
  | 'stale'
  | 'forbidden'
  | 'failed';
type AgentRequestResult<T> = Promise<Result<T, AgentRequestFailure>>;

/** Human review of agent access to one team's items. */
export type AgentRequestSource = {
  /** Every agent with a request or grant on the item, one state each. */
  forItem(
    itemId: string
  ): AgentRequestResult<PasswordAgentAccessRequestState[]>;
  resolve(
    itemId: string,
    requestId: string,
    decision: PasswordAgentResolveRequest
  ): AgentRequestResult<PasswordAgentAccessRequestState>;
  revoke(
    itemId: string,
    agentAccountId: string,
    body: PasswordAgentRevokeBody
  ): AgentRequestResult<PasswordAgentItemAccess>;
};

/** Cached callbacks capture only the resolved scope, source and item. */
export function agentRequestsQueryOptions(
  scopeKey: string,
  source: AgentRequestSource,
  itemId: string
) {
  return queryOptions({
    queryKey: passwordKeys.agentRequests(scopeKey, itemId).queryKey,
    queryFn: async () => {
      const result = await source.forItem(itemId);
      // Off, gone or not reviewable: nothing to show.
      if (result.isErr())
        return result.error === 'failed' ? Promise.reject(result.error) : [];
      return result.value;
    },
  });
}

const PAGE_LIMIT = 100;
/** One item has a handful of agents; this only bounds a misbehaving cursor. */
const MAX_PAGES = 10;

export function createAgentRequestSource(
  teamId: string,
  scope: PasswordSourceScope
): AgentRequestSource {
  const isCurrent = () => !scope.signal.aborted && scope.isCurrent();
  const root = `${SERVER_HOSTS['document-storage-service']}/passwords/teams/${encodeURIComponent(teamId)}`;
  async function request<T extends object>(
    path: string,
    method: 'GET' | 'POST',
    body?: object
  ): AgentRequestResult<T> {
    if (!isCurrent()) return err('failed');
    const response = await fetchWithToken<T>(`${root}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Macro-Passwords': '1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: scope.signal,
      retry: { maxTries: 1 },
    });
    if (!isCurrent()) return err('failed');
    return response.mapErr((errors) =>
      match(errors[0]?.code)
        .returnType<AgentRequestFailure>()
        .with('NOT_FOUND', () => 'unavailable')
        .with('CONFLICT', () => 'stale')
        .with('FORBIDDEN', () => 'forbidden')
        .otherwise(() => 'failed')
    );
  }
  return {
    forItem(itemId) {
      return Telemetry.span('passwords.agent_requests.list', async (span) => {
        span.setAttr('passwords.item_id', itemId);
        const states: PasswordAgentAccessRequestState[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const query = new URLSearchParams({
            itemId,
            limit: String(PAGE_LIMIT),
          });
          if (cursor) query.set('cursor', cursor);
          const result = await request<PasswordAgentAccessRequestPage>(
            `/agent-access-requests?${query}`,
            'GET'
          );
          if (result.isErr()) return err(result.error);
          states.push(...result.value.requests);
          cursor = result.value.nextCursor ?? null;
          if (!cursor) return ok(states);
        }
        return ok(states);
      });
    },
    resolve(itemId, requestId, decision) {
      return Telemetry.span(
        'passwords.agent_requests.resolve',
        async (span) => {
          span.setAttr('passwords.item_id', itemId);
          span.setAttr('passwords.request_id', requestId);
          span.setAttr('passwords.decision', decision.decision);
          return request<PasswordAgentAccessRequestState>(
            `/items/${encodeURIComponent(itemId)}/agent-access-requests/${encodeURIComponent(requestId)}/resolve`,
            'POST',
            decision
          );
        }
      );
    },
    revoke(itemId, agentAccountId, body) {
      return Telemetry.span('passwords.agent_requests.revoke', async (span) => {
        span.setAttr('passwords.item_id', itemId);
        span.setAttr('passwords.revoke_scope', body.scope);
        return request<PasswordAgentItemAccess>(
          `/items/${encodeURIComponent(itemId)}/agents/${encodeURIComponent(agentAccountId)}/revoke`,
          'POST',
          body
        );
      });
    },
  };
}
