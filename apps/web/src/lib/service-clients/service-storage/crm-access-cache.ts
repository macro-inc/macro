import { perfMark } from '@app/observability/perf-marks';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  guardResponseBody,
  registerResponseObserver,
} from '@core/util/response-observers';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import {
  initialCacheRetirement,
  readPrunedGeneration,
  rememberPrunedGeneration,
  startupAuthorityHint,
} from '@graphql-cache/generation-mirror';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import { fetchUserInfo } from '@queries/auth/user-info';
import { queryClient, queryPersistence } from '@queries/client';
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
let lastHintAttempt = 0;
let hintRefresh: Promise<void> | undefined;
let hintRerun = false;
let hintSession = 0;

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
  try {
    await cacheSessionGeneration.transition(async () => {
      // Cancel every pre-transition query; mutations retain their real server outcome.
      await queryClient.cancelQueries();
      // Permission changes are rare and CRM references can appear in any query
      // family. Retire every TanStack snapshot rather than maintain a second schema.
      if (scope) {
        await queryPersistence.retire(() => true);
        // Only a completed prune lets a later start skip it for this generation.
        rememberPrunedGeneration(generation);
      }
    }, generation);
  } finally {
    // Failed disk pruning remains quarantined, but fresh server reads can still
    // replace the retired memory snapshot once this transition has unpaused.
    if (cacheSessionGeneration.isCurrent(generation))
      fireAndForget(
        queryClient.refetchQueries({ type: 'active' }),
        'crm.access.refetch'
      );
  }
}

function refresh() {
  if (crmAccessAuthority.account())
    fireAndForget(crmAccessAuthority.refresh(), 'crm.access.refresh');
}

function refreshHint(hint: string) {
  if (hintRefresh) {
    lastMismatchedHint = hint;
    hintRerun = true;
    return;
  }
  if (hint === lastMismatchedHint && Date.now() - lastHintAttempt < 1_000)
    return;
  lastMismatchedHint = hint;
  lastHintAttempt = Date.now();
  hintRerun = false;
  const session = hintSession;
  const work = (async () => {
    let failure: unknown;
    try {
      await crmAccessAuthority.refresh();
    } catch (error) {
      failure = error;
    }
    // The joined proof may predate this hint. If it did not establish the
    // hinted policy, take one fresh proof after it settles; bursts coalesce.
    if (
      session === hintSession &&
      lastMismatchedHint &&
      lastMismatchedHint !== crmAccessAuthority.snapshot()?.policy &&
      (!failure || hintRerun)
    ) {
      await crmAccessAuthority.refresh();
      return;
    }
    if (failure) throw failure;
  })().finally(() => {
    if (hintRefresh === work) hintRefresh = undefined;
  });
  hintRefresh = work;
  fireAndForget(work, 'crm.access.hint');
}

function install() {
  if (installed) return;
  installed = true;
  configureCrmAccessAuthority({
    initialize(generation) {
      cacheSessionGeneration.initialize(generation);
      // urql keeps its observers and rereads only queries whose original
      // startup write stamp was rejected by the shared owner.
    },
    restore: (authority) => {
      const scope = initialCacheRetirement(
        startupAuthorityHint,
        authority,
        readPrunedGeneration()
      );
      if (scope)
        perfMark('cache.generation-baseline', {
          mirrorMatches: false,
          retirement: scope,
        });
      return scope ?? 'none';
    },
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
      const identity = await fetchUserInfo({ fresh: true });
      if (
        !identity.authenticated ||
        identity.userId !== account ||
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
  const storage = new URL(
    SERVER_HOSTS['document-storage-service'],
    document.baseURI
  );
  const base = storage.pathname.replace(/\/$/, '');
  registerResponseObserver((input, init) => {
    if (!crmAccessAuthority.account()) return;
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      document.baseURI
    );
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
      else if (isCrmPolicy(hint)) refreshHint(hint);
      else if (
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
    hintSession += 1;
    hintRefresh = undefined;
    hintRerun = false;
    lastMismatchedHint = undefined;
    refresh();
  }
}
