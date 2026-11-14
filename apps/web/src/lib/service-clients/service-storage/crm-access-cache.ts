import { beginQueryAuthorizationReset } from '@app/lib/urql-solid/authorization';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  guardResponseBody,
  registerResponseObserver,
} from '@core/util/response-observers';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  isQueuedSettlementRequest,
  rememberResponseAuthority,
} from '@graphql-cache/response-authority';
import { Telemetry } from '@macro-inc/observability';
import { queryClient, queryPersistence } from '@queries/client';
import { crmProtectedQueryKey } from '@queries/crm-cache-scope';
import { authServiceClient } from '@service-auth/client';
import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
  isCrmPolicy,
} from './crm-access-authority';

let host: CacheHost | undefined;
let installed = false;

async function fetchProof(): Promise<string> {
  const context = Telemetry.captureContext();
  const { dssFetch } = await import('./client');
  const result = await context.run(() =>
    dssFetch<{ team_id: string | null; allowed: boolean }>(
      '/crm/member-access',
      { signal: AbortSignal.timeout(15_000) }
    )
  );
  if (result.isErr() || typeof result.value.allowed !== 'boolean')
    throw new Error('Unable to verify CRM access');
  const policy =
    result.value.team_id === null
      ? 'none'
      : `${result.value.team_id}:${result.value.allowed ? 'allowed' : 'denied'}`;
  if (!isCrmPolicy(policy)) throw new Error('Invalid CRM access proof');
  return policy;
}

let resumeVisibleSnapshots: (() => void) | undefined;
async function retireVisibleSnapshots() {
  resumeVisibleSnapshots = beginQueryAuthorizationReset();
  if (host)
    recordExternalWrite(host, [
      'GraphqlUser',
      'GraphqlSoupCrmCompany',
      'GraphqlSoupCrmContact',
      'GraphqlSoupEmailThread',
      'GraphqlCrmPipeline',
    ]);
  await queryPersistence.retire(crmProtectedQueryKey);
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
  registerResponseObserver(async (input, init) => {
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
    const agentActivity =
      matches(SERVER_HOSTS['agent-harness']) &&
      /\/agent-sessions\/[^/]+\/activity$/.test(url.pathname);
    if (!storage && !matches(SERVER_HOSTS['email-service']) && !agentActivity)
      return;
    if (storage && url.pathname.endsWith('/crm/member-access')) return;
    const queuedMutation = isQueuedSettlementRequest(init);
    const captured = await crmAccessAuthority.prepare();
    return async (response) => {
      let admitted: typeof captured | undefined = captured;
      let rejected: unknown;
      try {
        const policy = response.headers.get('x-macro-crm-access');
        if (storage && isCrmPolicy(policy))
          admitted = await crmAccessAuthority.accept(captured, policy);
        else {
          await crmAccessAuthority.refresh();
          await crmAccessAuthority.assertCurrent(captured);
        }
      } catch (error) {
        // Successful queued mutations still need their canonical identity to
        // settle. Their old token cannot publish response content or optimism.
        if (!queuedMutation || !response.ok) throw error;
        admitted = undefined;
        rejected = error;
      }
      const check = async () => {
        if (!admitted) throw rejected ?? new StaleCacheAuthorityError();
        await crmAccessAuthority.assertCurrent(admitted);
      };
      rememberResponseAuthority(response, admitted?.generation, check);
      return guardResponseBody(response, async () => {
        try {
          await check();
        } catch (error) {
          if (!queuedMutation) throw error;
        }
      });
    };
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
