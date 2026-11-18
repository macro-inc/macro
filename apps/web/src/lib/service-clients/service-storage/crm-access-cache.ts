import { beginQueryAuthorizationReset } from '@app/lib/urql-solid/authorization';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  guardResponseBody,
  type ResponseGuard,
  registerResponseObserver,
} from '@core/util/response-observers';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  isQueuedSettlementRequest,
  rememberResponseAuthority,
  rememberResponseSession,
  rememberWriteResponse,
} from '@graphql-cache/response-authority';
import { Telemetry } from '@macro-inc/observability';
import { queryClient, queryPersistence } from '@queries/client';
import { crmProtectedQueryKey } from '@queries/crm-cache-scope';
import { authServiceClient } from '@service-auth/client';
import { onlineManager } from '@tanstack/solid-query';
import { dssFetch } from './client';
import {
  type CrmRetirementScope,
  configureCrmAccessAuthority,
  crmAccessAuthority,
  isCrmPolicy,
} from './crm-access-authority';
import {
  crmResponseScope,
  isEmailReminderPath,
  isHistoryItemPath,
} from './crm-response-scope';
import type { CrmMemberAccessResponse } from './generated/schemas/crmMemberAccessResponse';

let host: CacheHost | undefined;
let installed = false;

async function fetchProof(timeoutMs: number): Promise<string> {
  const context = Telemetry.captureContext();
  const signal = AbortSignal.timeout(timeoutMs);
  const result = await context.run(() =>
    dssFetch<CrmMemberAccessResponse>('/crm/member-access', {
      cache: 'no-store',
      signal,
    })
  );
  if (result.isErr()) {
    if (
      !signal.aborted &&
      result.error.some((error) => error.code === 'NETWORK_ERROR')
    )
      throw new TypeError('Unable to verify CRM access');
    throw new Error('Unable to verify CRM access');
  }
  if (result.value == null || typeof result.value.allowed !== 'boolean')
    throw new Error('Unable to verify CRM access');
  const policy =
    result.value.team_id == null
      ? 'none'
      : `${result.value.team_id}:${result.value.allowed ? 'allowed' : 'denied'}`;
  if (!isCrmPolicy(policy)) throw new Error('Invalid CRM access proof');
  return policy;
}

let resumeVisibleSnapshots: (() => void) | undefined;
let independentSessionRetirement: Promise<void> | undefined;

function sessionSnapshotKey(key: readonly unknown[]): boolean {
  const [kind, scope] = key;
  // Reminder details can be seeded from collections belonging to any account.
  // Retire both prefixes before replacement-login readers resume.
  return (
    kind === 'email' ||
    kind === 'soup' ||
    (kind === 'reminders' &&
      ['email', 'emailCollection'].includes(String(scope)))
  );
}

async function refetchIndependentSessionSnapshots() {
  const retirement = independentSessionRetirement;
  if (!retirement || !crmAccessAuthority.account()) return;
  await retirement;
  if (
    retirement !== independentSessionRetirement ||
    !crmAccessAuthority.account()
  )
    return;
  independentSessionRetirement = undefined;
  await queryClient.refetchQueries({
    type: 'active',
    predicate: (query) =>
      sessionSnapshotKey(query.queryKey) &&
      !crmProtectedQueryKey(query.queryKey),
  });
}

async function retireVisibleSnapshots(scope: CrmRetirementScope) {
  resumeVisibleSnapshots = beginQueryAuthorizationReset();
  if (host)
    recordExternalWrite(host, [
      'GraphqlUser',
      'GraphqlSoupCrmCompany',
      'GraphqlSoupCrmContact',
      'GraphqlSoupEmailThread',
      'GraphqlCrmPipeline',
    ]);
  const retirement = queryPersistence.retire(
    (key) =>
      (scope === 'session' && sessionSnapshotKey(key)) ||
      crmProtectedQueryKey(key)
  );
  if (scope === 'session') independentSessionRetirement = retirement;
  await retirement;
  // Persistence rebinds observers without fetching. Independent mail and flat
  // Soup readers resume after session cleanup even without CRM proof.
  if (scope === 'session')
    fireAndForget(
      refetchIndependentSessionSnapshots(),
      'crm.access.mail_refetch'
    );
}

function verifiedVisibleSnapshots() {
  const resume = resumeVisibleSnapshots;
  if (!resume) return;
  resumeVisibleSnapshots = undefined;
  resume();
  // The response performing retirement must finish before an active REST read
  // is reissued. The shared owner has already retired normalized snapshots.
  setTimeout(
    () =>
      fireAndForget(
        queryClient.refetchQueries({
          type: 'active',
          predicate: (query) => crmProtectedQueryKey(query.queryKey),
        }),
        'crm.access.refetch'
      ),
    0
  );
}

function install() {
  if (installed) return;
  installed = true;
  configureCrmAccessAuthority({
    fetchProof,
    retire: retireVisibleSnapshots,
    verified: verifiedVisibleSnapshots,
    async bindAccount(owner, generation, account) {
      const target = host;
      if (
        !target ||
        target.authority !== owner ||
        crmAccessAuthority.account() !== account
      )
        throw new StaleCacheAuthorityError();
      // Never bind from restored user-info. A fresh authenticated response
      // must match this login, and the pre-fetch owner generation fences the write.
      const identity = await authServiceClient.getLegacyUserPermissions();
      if (
        identity.isErr() ||
        !identity.value.authenticated ||
        identity.value.userId !== account ||
        target !== host ||
        crmAccessAuthority.account() !== account
      )
        throw new StaleCacheAuthorityError();
      try {
        await target.writeQuery({
          query: '{ user { id } }',
          data: { user: { id: account } },
          identity: account,
          authorityGeneration: generation,
        });
      } catch (error) {
        if (
          !(error instanceof StaleCacheAuthorityError) ||
          (await owner.current()).account !== account
        )
          throw error;
      }
    },
  });
  crmAccessAuthority.onSessionChanged(() => {
    fireAndForget(
      refetchIndependentSessionSnapshots(),
      'crm.access.mail_refetch'
    );
  });
  onlineManager.subscribe((online) => {
    if (
      online &&
      crmAccessAuthority.account() &&
      ['pending', 'error'].includes(crmAccessAuthority.state())
    )
      fireAndForget(crmAccessAuthority.refresh(), 'crm.access.reconnect');
  });
  registerResponseObserver((input, init) => {
    if (!crmAccessAuthority.account()) return;
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      document.baseURI
    );
    const matches = (base: string) => {
      const parsed = new URL(base, document.baseURI);
      return (
        url.origin === parsed.origin &&
        url.pathname.startsWith(`${parsed.pathname.replace(/\/$/, '')}/`)
      );
    };
    const storage = matches(SERVER_HOSTS['document-storage-service']);
    const email = matches(SERVER_HOSTS['email-service']);
    const agentActivity =
      matches(SERVER_HOSTS['agent-harness']) &&
      /\/agent-sessions\/[^/]+\/activity$/.test(url.pathname);
    if (!storage && !email && !agentActivity) return;
    if (storage && url.pathname.endsWith('/crm/member-access')) return;
    const base = storage
      ? SERVER_HOSTS['document-storage-service']
      : agentActivity
        ? SERVER_HOSTS['agent-harness']
        : SERVER_HOSTS['email-service'];
    const path = url.pathname.slice(
      new URL(base, document.baseURI).pathname.replace(/\/$/, '').length
    );
    const assertSession = crmAccessAuthority.captureSession();
    const scope = crmResponseScope(
      storage ? 'storage' : agentActivity ? 'agent' : 'email',
      path,
      input,
      init
    );
    const observeScope = (
      scope: Awaited<ReturnType<typeof crmResponseScope>>
    ): ResponseGuard | undefined | Promise<ResponseGuard> => {
      const queuedMutation = isQueuedSettlementRequest(init);
      if (!scope.protected) {
        if (
          !email &&
          !queuedMutation &&
          !path.endsWith('/graphql') &&
          path !== '/items/soup/ast' &&
          !isEmailReminderPath(path) &&
          !isHistoryItemPath(path)
        )
          return;
        assertSession();
        return (response) => {
          // Independent replies retain the login fence without waiting for
          // CRM proof or rejecting a same-login permission generation change.
          rememberResponseSession(response, assertSession);
          // Durable commands must settle returned IDs even after login changes;
          // the publication check still rejects their copied content.
          if (queuedMutation && response.ok) return response;
          assertSession();
          return guardResponseBody(response, assertSession);
        };
      }
      assertSession();
      return (async () => {
        if (storage) {
          const headers = new Headers(
            init.headers ??
              (input instanceof Request ? input.headers : undefined)
          );
          headers.set('x-macro-crm-access-signal', '1');
          init.headers = headers;
        }
        const captured = await crmAccessAuthority.prepare();
        return async (response: Response) => {
          let admitted: typeof captured | undefined = captured;
          let rejected: unknown;
          try {
            const policy = response.headers.get('x-macro-crm-access');
            const current = await captured.owner.current();
            if (
              !storage ||
              (isCrmPolicy(policy) && policy === current.policy)
            ) {
              try {
                await crmAccessAuthority.assertCurrent(captured);
              } catch {
                // Recover from a prior unavailable proof without trusting the hint.
                await crmAccessAuthority.refresh();
              }
            } else {
              await crmAccessAuthority.refresh();
            }
            // Hints can be memoized or read after the handler. Only a fresh proof
            // changes authority; the response always retains its original generation.
            await crmAccessAuthority.assertCurrent(captured);
          } catch (error) {
            // An ordinary write keeps its real outcome, while a successful queued
            // write still needs its identity to settle. Neither can publish rejected
            // content to a cache; only reads fail when content admission fails.
            if (
              !(scope.write && !queuedMutation) &&
              (!queuedMutation || !response.ok)
            )
              throw error;
            admitted = undefined;
            rejected = error;
          }
          const check = async () => {
            if (!admitted) throw rejected ?? new StaleCacheAuthorityError();
            await crmAccessAuthority.assertCurrent(admitted);
          };
          rememberResponseAuthority(response, admitted?.generation, check);
          if (scope.write && !queuedMutation) {
            assertSession();
            rememberWriteResponse(response, assertSession);
            return guardResponseBody(response, async () => assertSession());
          }
          return guardResponseBody(response, async () => {
            try {
              await check();
            } catch (error) {
              if (!queuedMutation) throw error;
            }
          });
        };
      })();
    };
    return scope instanceof Promise
      ? scope.then(observeScope)
      : observeScope(scope);
  });
}

export function installCrmCacheHost(next: CacheHost | undefined) {
  install();
  host = next;
  crmAccessAuthority.setHost(next?.disabled ? undefined : next?.authority);
}

export function setCrmAccessSession(account: string | undefined, epoch = 0) {
  install();
  crmAccessAuthority.setSession(account, epoch);
  if (account)
    fireAndForget(crmAccessAuthority.refresh(), 'crm.access.refresh');
}
