import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import { sleep } from '@core/util/sleep';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { startupAuthorityHint } from '@graphql-cache/generation-mirror';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';

export type CrmAccessState = 'pending' | 'allowed' | 'denied' | 'error';
export type CrmRetirementScope = 'permission' | 'session';
/** What the first owner observation retires; `none` is a decision, not a gap. */
export type CrmInitialRetirement = CrmRetirementScope | 'none';
type Options = {
  hint?: CacheAuthority;
  earlyProof?: boolean;
  initialize?: (generation: string) => void;
  restore?: (authority: CacheAuthority) => CrmInitialRetirement | undefined;
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
function memoryAuthority(
  account?: string,
  from?: CacheAuthority
): CacheAuthorityHost {
  let state: CacheAuthority = {
    identity: 'network-only',
    account: account ?? null,
    generation: from?.generation ?? crypto.randomUUID(),
    // Still compared: another policy has to end the generation.
    policy: from?.policy ?? null,
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
  let initialized = false;
  let stopObserving: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let initialization: Promise<void> | undefined;
  let retiring = Promise.resolve();
  let requiredRetirement: CrmRetirementScope | undefined;
  let retirementAttempt = Symbol();
  let retirementFailed = false;
  let fencedAccount: string | undefined;
  let observationVersion = 0;
  let earlyProofStarted = false;
  let earlyAccess: 'allowed' | 'denied' | undefined;
  // A server denial remains authoritative if writing its durable marker fails,
  // or if the owner that recorded it is replaced by one that has not. It is
  // bound to that owner and generation: another read of the same baseline
  // cannot reopen CRM, and only a committed grant, a newer generation of the
  // same owner or a new login supersedes it.
  let deniedProof:
    | { owner: CacheAuthorityHost; generation: string }
    | undefined;

  function observe(next: CacheAuthority, retryRetirement = false) {
    const previous = observed;
    observationVersion += 1;
    if (
      deniedProof?.owner === owner &&
      deniedProof.generation !== next.generation
    )
      deniedProof = undefined;
    if (
      (next.account !== null && next.account !== account) ||
      (previous && previous.generation !== next.generation) ||
      (next.policy !== null && (!next.ready || earlyAccess === 'allowed'))
    )
      earlyAccess = undefined;
    if (next.account != null && next.account !== account) {
      setState('pending');
      if (account !== undefined && previous === undefined) {
        // Login may precede the first owner observation. Fence the account
        // discovered now without ever installing its old generation.
        if (fencedAccount !== next.account) {
          fencedAccount = next.account;
          retire('session', crypto.randomUUID());
        }
        return;
      }
    } else if (isCrmPolicy(next.policy)) {
      if (deniedProof || next.policy.endsWith(':denied')) setState('denied');
      else setState(next.ready ? (earlyAccess ?? 'allowed') : 'pending');
    } else setState(deniedProof ? 'denied' : (earlyAccess ?? 'pending'));
    observed = next;
    if (!initialized) {
      initialized = true;
      const scope =
        options.restore?.(next) ??
        (next.policy?.endsWith(':denied') ? 'permission' : 'none');
      if (scope === 'none') options.initialize?.(next.generation);
      else retire(scope, next.generation);
      return;
    }
    if (previous?.generation === next.generation) {
      if (retryRetirement && retirementFailed)
        retire(undefined, next.generation);
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
    initialized = true;
    if (scope === 'session' || !requiredRetirement) requiredRetirement = scope;
    const attempt = Symbol();
    retirementAttempt = attempt;
    // Fence responses synchronously, before any local cleanup awaits.
    // Keep the strongest outstanding cleanup across login and owner replacement.
    const work = options
      .retire(requiredRetirement, generation)
      .then(() => {
        if (retirementAttempt === attempt) {
          requiredRetirement = undefined;
          retirementFailed = false;
        }
      })
      .catch((error: unknown) => {
        if (retirementAttempt === attempt) retirementFailed = true;
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
    if (
      options.earlyProof &&
      !earlyProofStarted &&
      !options.hint &&
      !initialized &&
      !observed &&
      !target.snapshot()
    ) {
      earlyProofStarted = true;
      const version = observationVersion;
      // This response opens UI only; it cannot borrow a generation learned
      // after dispatch. The normal proof below commits under the owner's CAS.
      fireAndForget(
        Telemetry.span('crm.access.startup_hint', async () => {
          const policy = await options.fetchProof(3_000);
          if (!current() || version !== observationVersion) return;
          if (!isCrmPolicy(policy))
            throw new Error('Invalid CRM access policy');
          earlyAccess = policy.endsWith(':denied') ? 'denied' : 'allowed';
          setState(earlyAccess);
        }),
        'crm.access.startup_hint'
      );
    }
    const work = Telemetry.span('crm.access.refresh', async (span) => {
      for (let attempt = 0; ; attempt++) {
        try {
          let before = await span.span('crm.access.current', () =>
            target.current()
          );
          if (!current()) return;
          span.run(() => observe(before, true));
          const bindAccount = options.bindAccount;
          if (before.account !== expectedAccount && bindAccount) {
            await span.span('crm.access.bind_account', () =>
              bindAccount(target, before.generation, expectedAccount)
            );
            before = await span.span('crm.access.current', () =>
              target.current()
            );
            if (!current()) return;
            span.run(() => observe(before, true));
          }
          const policy = await span.span('crm.access.proof', () =>
            options.fetchProof(attempt === 0 ? 15_000 : 3_000)
          );
          if (!current()) return;
          if (!isCrmPolicy(policy))
            throw new Error('Invalid CRM access policy');
          if (observed && observed.generation !== before.generation)
            throw new StaleCacheAuthorityError();
          earlyAccess = undefined;
          // A proven denial hides entry points even if local disk cleanup fails.
          const denied = policy.endsWith(':denied');
          const newlyDenied =
            denied &&
            !(
              deniedProof?.owner === target &&
              deniedProof.generation === before.generation
            );
          if (denied) {
            deniedProof = { owner: target, generation: before.generation };
            setState('denied');
          }
          const result = await span.span('crm.access.transition', async () => {
            try {
              return await target.transition(before.generation, policy);
            } catch (error) {
              // Without the owner's durable marker, retire this page's own
              // copies once for the baseline the denial was proven against.
              // A moved owner is proven again against its new baseline.
              if (
                newlyDenied &&
                current() &&
                observed?.generation === before.generation &&
                !(error instanceof StaleCacheAuthorityError)
              )
                retire('permission', before.generation);
              throw error;
            }
          });
          if (!current()) return;
          deniedProof = denied
            ? { owner: target, generation: result.authority.generation }
            : undefined;
          span.run(() => observe(result.authority));
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
    initialize() {
      initialization ??= (async () => {
        const target = owner;
        const captured = session;
        const initial = await target.current();
        if (target === owner && captured === session) observe(initial);
      })();
      return initialization;
    },
    refresh,
    /** Without a host, `paused` is what a paused host still has, so that
     * neither losing nor regaining it counts as a new session. */
    setHost(next: CacheAuthorityHost | undefined, paused?: CacheAuthority) {
      if (next === shared) return;
      shared = next;
      if (earlyAccess) setState('pending');
      earlyAccess = undefined;
      owner = next ?? memoryAuthority(account, paused);
      session = Symbol();
      pending = undefined;
      initialization = undefined;
      subscribe();
      if (account) fireAndForget(refresh(), 'crm.access.host');
    },
    setSession(next: string | undefined, epoch = 0) {
      if (next === account && epoch === loginEpoch) return false;
      const sameAccount = next === account;
      const firstAccount = account === undefined;
      const previousAccount = account ?? observed?.account;
      if (previousAccount != null && previousAccount !== next) {
        fencedAccount = previousAccount;
        retire('session', crypto.randomUUID());
        observed = undefined;
      }
      account = next;
      if (earlyAccess) setState('pending');
      earlyAccess = undefined;
      loginEpoch = epoch;
      deniedProof = undefined;
      session = Symbol();
      pending = undefined;
      initialization = undefined;
      if (sameAccount) return true;
      // The matching ready allowed hint opens UI only. Fresh server reads still
      // enforce access and copied writes remain fenced by the shared owner.
      const hint = observed ?? (!initialized ? options.hint : undefined);
      const hintedAllowed =
        next !== undefined &&
        hint?.account === next &&
        hint.ready &&
        isCrmPolicy(hint.policy) &&
        !hint.policy.endsWith(':denied');
      const hintedDenied =
        next !== undefined &&
        hint?.account === next &&
        hint.policy?.endsWith(':denied');
      setState(hintedDenied ? 'denied' : hintedAllowed ? 'allowed' : 'pending');
      if (!shared) {
        owner = memoryAuthority(
          account,
          firstAccount ? owner.snapshot() : undefined
        );
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
// Native CRM email lists can restore REST pages independently of owner startup.
// Web's persisted CRM reads observe the owner before their ready handshake.
const allowEarlyAccess = !isTauri();
export const crmAccessAuthority = createCrmAccessAuthority({
  hint: allowEarlyAccess ? startupAuthorityHint : undefined,
  earlyProof: allowEarlyAccess,
  initialize: (generation) => configured.initialize?.(generation),
  restore: (authority) => configured.restore?.(authority),
  fetchProof: (timeoutMs) => configured.fetchProof(timeoutMs),
  retire: (scope, generation) => configured.retire(scope, generation),
  bindAccount: (owner, generation, account) =>
    configured.bindAccount?.(owner, generation, account) ?? Promise.resolve(),
});
/** Entry points keep their existing behavior until access is proven denied. */
export const crmAccessAllowed = () => crmAccessAuthority.state() !== 'denied';
export const crmAccessState = crmAccessAuthority.state;
export function configureCrmAccessAuthority(options: Options) {
  configured = options;
}
