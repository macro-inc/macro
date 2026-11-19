import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  guardResponseBody,
  registerResponseObserver,
} from '@core/util/response-observers';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import { queryClient, queryPersistence } from '@queries/client';
import { crmProtectedQueryKey } from '@queries/crm-cache-scope';
import { authServiceClient } from '@service-auth/client';
import { focusManager, onlineManager } from '@tanstack/solid-query';
import { dssFetch } from './client';
import {
  type CrmRetirementScope,
  configureCrmAccessAuthority,
  crmAccessAuthority,
  isCrmPolicy,
} from './crm-access-authority';
import type { CrmMemberAccessResponse } from './generated/schemas/crmMemberAccessResponse';

let host: CacheHost | undefined;
let installed = false;
let lastMismatchedHint: string | undefined;

async function fetchProof(timeoutMs: number): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  const result = await dssFetch<CrmMemberAccessResponse>('/crm/member-access', {
    cache: 'no-store',
    signal,
  });
  if (result.isErr()) {
    if (
      !signal.aborted &&
      result.error.some((error) => error.code === 'NETWORK_ERROR')
    )
      throw new TypeError('Unable to verify CRM access');
    throw new Error('Unable to verify CRM access');
  }
  if (result.value == null || typeof result.value.allowed !== 'boolean')
    throw new Error('Invalid CRM access response');
  return result.value.team_id == null
    ? 'none'
    : `${result.value.team_id}:${result.value.allowed ? 'allowed' : 'denied'}`;
}

async function retireVisibleSnapshots(
  scope: CrmRetirementScope | undefined,
  generation: string
) {
  await cacheSessionGeneration.transition(async () => {
    // Cancel every pre-transition query; mutations retain their real server outcome.
    await queryClient.cancelQueries();
    if (scope)
      await queryPersistence.retire(
        scope === 'session' ? () => true : crmProtectedQueryKey
      );
  }, generation);
  if (!cacheSessionGeneration.isCurrent(generation)) return;
  fireAndForget(
    queryClient.refetchQueries({ type: 'active' }),
    'crm.access.refetch'
  );
}

function refresh() {
  if (crmAccessAuthority.account())
    fireAndForget(crmAccessAuthority.refresh(), 'crm.access.refresh');
}

function install() {
  if (installed) return;
  installed = true;
  configureCrmAccessAuthority({
    initialize: cacheSessionGeneration.initialize,
    fetchProof,
    retire: retireVisibleSnapshots,
    async bindAccount(owner, generation, account) {
      const context = Telemetry.captureContext();
      const target = host;
      if (
        !target ||
        target.authority !== owner ||
        crmAccessAuthority.account() !== account
      )
        throw new StaleCacheAuthorityError();
      // Only fresh authenticated identity may bind a restored anonymous profile.
      const identity = await authServiceClient.getLegacyUserPermissions();
      if (
        identity.isErr() ||
        !identity.value.authenticated ||
        identity.value.userId !== account ||
        target !== host ||
        crmAccessAuthority.account() !== account
      )
        throw new StaleCacheAuthorityError();
      await context.run(() =>
        target.writeQuery({
          query: '{ user { id } }',
          data: { user: { id: account } },
          identity: account,
          generation,
        })
      );
    },
  });
  focusManager.subscribe((focused) => {
    if (focused) refresh();
  });
  onlineManager.subscribe((online) => {
    if (online) refresh();
  });
  registerResponseObserver((input, init) => {
    if (!crmAccessAuthority.account()) return;
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      document.baseURI
    );
    const storage = new URL(
      SERVER_HOSTS['document-storage-service'],
      document.baseURI
    );
    const base = storage.pathname.replace(/\/$/, '');
    const isStorage =
      url.origin === storage.origin && url.pathname.startsWith(`${base}/`);
    const path = isStorage ? url.pathname.slice(base.length) : '';
    if (path === '/crm/member-access') return;
    if (isStorage) {
      const headers = new Headers(
        init.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.set('x-macro-crm-access-signal', '1');
      init.headers = headers;
    }
    const generation = cacheSessionGeneration.capture();
    const method = (
      init.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    return (response) => {
      const hint = response.headers.get('x-macro-crm-access');
      const policy = crmAccessAuthority.snapshot()?.policy;
      if (hint === policy) lastMismatchedHint = undefined;
      else if (isCrmPolicy(hint) && hint !== lastMismatchedHint) {
        lastMismatchedHint = hint;
        refresh();
      } else if (
        isStorage &&
        path.startsWith('/crm/') &&
        response.status === 403 &&
        crmAccessAuthority.state() !== 'denied'
      )
        refresh();
      // GraphQL distinguishes queries from mutations in its exchange. REST writes
      // keep their outcome; TanStack cancellation fences POST-based query results.
      if (method !== 'GET' && method !== 'HEAD') return response;
      return guardResponseBody(response, () => {
        if (!cacheSessionGeneration.isCurrent(generation))
          throw new StaleCacheAuthorityError();
      });
    };
  });
}

export function installCrmCacheHost(next: CacheHost | undefined) {
  install();
  host = next;
  crmAccessAuthority.setHost(next?.disabled ? undefined : next?.authority);
}

/** Local owner initialization only; permission verification starts after login. */
export function initializeCrmCacheOwner() {
  install();
  return crmAccessAuthority.initialize();
}

export function setCrmAccessSession(account: string | undefined, epoch = 0) {
  install();
  if (crmAccessAuthority.setSession(account, epoch)) {
    lastMismatchedHint = undefined;
    refresh();
  }
}
