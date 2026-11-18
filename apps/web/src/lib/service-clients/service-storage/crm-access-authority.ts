import { fireAndForget } from '@core/util/fireAndForget';
import { sleep } from '@core/util/sleep';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';

export type CrmAccessState = 'pending' | 'allowed' | 'denied' | 'error';
export type CrmRetirementScope = 'permission' | 'session';
type Options = {
  fetchProof: (timeoutMs: number) => Promise<string>;
  retire: (
    scope: CrmRetirementScope | undefined,
    generation: string
  ) => Promise<void>;
  bindAccount?: (
    owner: CacheAuthorityHost,
    generation: string,
    account: string
  ) => Promise<void>;
};

export function isCrmPolicy(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(allowed|denied))$/.test(
      value
    )
  );
}

/** Network-only sessions still retire their visible and persisted query results. */
function memoryAuthority(account?: string): CacheAuthorityHost {
  let state: CacheAuthority = {
    identity: 'network-only',
    account: account ?? null,
    generation: crypto.randomUUID(),
    policy: null,
    ready: false,
  };
  const listeners = new Set<(state: CacheAuthority) => void>();
  return {
    current: async () => state,
    snapshot: () => state,
    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async transition(expected, policy) {
      if (expected !== state.generation) throw new StaleCacheAuthorityError();
      const changed =
        (state.policy != null && state.policy !== policy) ||
        (policy.endsWith(':denied') && state.policy !== policy);
      state = {
        ...state,
        generation: changed ? crypto.randomUUID() : state.generation,
        policy,
        ready: true,
      };
      for (const listener of listeners) listener(state);
      return { authority: state, revision: '0', affectedOps: [], changed };
    },
  };
}

/** Detect rare access transitions; ordinary requests and cache reads never await this. */
export function createCrmAccessAuthority(options: Options) {
  const [state, setState] = createSignal<CrmAccessState>('pending');
  let account: string | undefined;
  let loginEpoch = 0;
  let session = Symbol();
  let shared: CacheAuthorityHost | undefined;
  let owner = memoryAuthority();
  let observed: CacheAuthority | undefined;
  let stopObserving: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let retiring = Promise.resolve();
  let failedRetirement:
    | { scope: CrmRetirementScope | undefined; generation: string }
    | undefined;

  function observe(next: CacheAuthority, retryRetirement = false) {
    const previous = observed;
    observed = next;
    if (next.account != null && next.account !== account) {
      setState('pending');
    } else if (isCrmPolicy(next.policy)) {
      if (next.policy.endsWith(':denied') || next.policy === 'none')
        setState('denied');
      else if (next.ready) setState('allowed');
    }
    if (previous?.generation === next.generation) {
      if (retryRetirement && failedRetirement?.generation === next.generation) {
        const { scope, generation } = failedRetirement;
        failedRetirement = undefined;
        retire(scope, generation);
      }
      return;
    }
    const accountChanged =
      previous?.account != null && previous.account !== next.account;
    const teamChanged =
      previous?.policy != null &&
      previous.policy !== 'none' &&
      previous.policy.split(':')[0] !== next.policy?.split(':')[0];
    const scope = accountChanged
      ? 'session'
      : teamChanged || next.policy?.endsWith(':denied')
        ? 'permission'
        : undefined;
    retire(scope, next.generation);
  }
  function retire(scope: CrmRetirementScope | undefined, generation: string) {
    // Fence responses synchronously, before any local cleanup awaits.
    const work = options.retire(scope, generation).catch((error: unknown) => {
      if (observed?.generation === generation)
        failedRetirement = { scope, generation };
      throw error;
    });
    retiring = Promise.all([retiring.catch(() => {}), work]).then(() => {});
    fireAndForget(retiring, 'crm.access.retirement');
  }

  function subscribe() {
    stopObserving?.();
    const captured = owner;
    stopObserving = owner.onChanged((next) => {
      if (owner === captured) observe(next);
    });
  }
  subscribe();

  function refresh(): Promise<void> {
    if (pending) return pending;
    if (!account) return Promise.resolve();
    if (state() === 'error') setState('pending');
    const captured = session;
    const target = owner;
    const expectedAccount = account;
    const current = () =>
      captured === session && target === owner && expectedAccount === account;
    const work = Telemetry.span('crm.access.refresh', async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          let before = await target.current();
          if (!current()) return;
          if (before.account !== expectedAccount && options.bindAccount) {
            await options.bindAccount(
              target,
              before.generation,
              expectedAccount
            );
            before = await target.current();
          }
          if (!current()) return;
          observe(before, true);
          const policy = await options.fetchProof(
            attempt === 0 ? 15_000 : 3_000
          );
          if (!current()) return;
          if (!isCrmPolicy(policy))
            throw new Error('Invalid CRM access policy');
          // A proven denial hides entry points even if local disk cleanup fails.
          if (policy.endsWith(':denied') || policy === 'none')
            setState('denied');
          const result = await target.transition(before.generation, policy);
          if (!current()) return;
          observe(result.authority);
          await retiring;
          return;
        } catch (error) {
          if (!current()) return;
          if (
            attempt === 1 ||
            !(
              error instanceof TypeError ||
              error instanceof StaleCacheAuthorityError
            )
          )
            throw error;
          if (error instanceof TypeError) await sleep(250);
          if (!current()) return;
        }
      }
    })
      .catch((error: unknown) => {
        if (current() && state() === 'pending') setState('error');
        throw error;
      })
      .finally(() => {
        if (pending === work) pending = undefined;
      });
    pending = work;
    return work;
  }

  return {
    state,
    allowed: () => state() === 'allowed',
    account: () => account,
    snapshot: () => observed ?? owner.snapshot(),
    refresh,
    setHost(next: CacheAuthorityHost | undefined) {
      if (next === shared) return;
      shared = next;
      owner = next ?? memoryAuthority(account);
      session = Symbol();
      pending = undefined;
      observed = undefined;
      subscribe();
      if (account) fireAndForget(refresh(), 'crm.access.host');
    },
    setSession(next: string | undefined, epoch = 0) {
      if (next === account && epoch === loginEpoch) return false;
      if (account !== undefined) retire('session', crypto.randomUUID());
      account = next;
      loginEpoch = epoch;
      session = Symbol();
      pending = undefined;
      observed = undefined;
      failedRetirement = undefined;
      setState('pending');
      if (!shared) {
        owner = memoryAuthority(account);
        subscribe();
      }
      return true;
    },
  };
}

let configured: Options = {
  fetchProof: async () => {
    throw new Error('CRM permission endpoint is unavailable');
  },
  retire: async () => {},
};
export const crmAccessAuthority = createCrmAccessAuthority({
  fetchProof: (timeoutMs) => configured.fetchProof(timeoutMs),
  retire: (scope, generation) => configured.retire(scope, generation),
  bindAccount: (owner, generation, account) =>
    configured.bindAccount?.(owner, generation, account) ?? Promise.resolve(),
});
export const crmAccessAllowed = crmAccessAuthority.allowed;
export const crmAccessState = crmAccessAuthority.state;
export function configureCrmAccessAuthority(options: Options) {
  configured = options;
}
