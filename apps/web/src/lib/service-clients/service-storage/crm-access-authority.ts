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

export type CrmRequestAuthority = Readonly<{
  owner: CacheAuthorityHost;
  generation: string;
  session: number;
}>;

export function isCrmPolicy(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(allowed|denied))$/.test(
      value
    )
  );
}

/** Network-only clients have no shared persisted response cache. */
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
    setReadGuard: () => {},
    verifyRead: async () => {
      if (!state.ready) throw new StaleCacheAuthorityError();
    },
    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async transition(expected, policy) {
      if (expected !== state.generation) throw new StaleCacheAuthorityError();
      const changed = !state.ready || state.policy !== policy;
      if (changed) {
        state = {
          ...state,
          generation: crypto.randomUUID(),
          policy,
          ready: true,
        };
        for (const listener of listeners) listener(state);
      }
      return { authority: state, revision: '0', affectedOps: [], changed };
    },
  };
}

/** Fresh primary proofs are ordered by the shared cache owner's generation. */
export function createCrmAccessAuthority(options: {
  fetchProof: (timeoutMs: number) => Promise<string>;
  retire: (scope: CrmRetirementScope) => Promise<void>;
  verified?: () => void;
  bindAccount?: (
    owner: CacheAuthorityHost,
    generation: string,
    account: string
  ) => Promise<void>;
}) {
  const [state, setState] = createSignal<CrmAccessState>('pending');
  const allowed = () => state() === 'allowed';
  let verifiedProof: CrmRequestAuthority | undefined;
  let account: string | undefined;
  let loginEpoch = 0;
  let loginGeneration = 0;
  let session = 0;
  let shared: CacheAuthorityHost | undefined;
  let owner = memoryAuthority();
  let stopObserving: (() => void) | undefined;
  let observedGeneration: string | undefined;
  let observedPolicy: string | null | undefined;
  let observedAccount: string | null | undefined;
  let retiredGeneration: string | undefined;
  let retiring = Promise.resolve();
  let retirementFailed = false;
  let sessionRetirementPending = false;
  const sessionListeners = new Set<() => void>();
  const verifiedListeners = new Set<() => void>();
  let pending:
    | {
        session: number;
        owner: CacheAuthorityHost;
        promise: Promise<CrmRequestAuthority>;
      }
    | undefined;

  const retire = (
    generation: string,
    scope: CrmRetirementScope = 'permission'
  ) => {
    const replacingSession = scope === 'session' && !sessionRetirementPending;
    if (scope === 'session') sessionRetirementPending = true;
    if (
      retiredGeneration === generation &&
      !retirementFailed &&
      !replacingSession
    )
      return;
    retiredGeneration = generation;
    retirementFailed = false;
    // A failed or overlapping login cleanup must not be narrowed to CRM-only
    // retirement by a later permission event.
    const retirementScope = sessionRetirementPending ? 'session' : 'permission';
    // The callback fences visible observers synchronously, before its disk work.
    const previous = retiring.catch(() => {});
    const work = Telemetry.span('crm.access.visible_retirement', async () =>
      options.retire(retirementScope)
    );
    retiring = Promise.allSettled([previous, work])
      .then(([, result]) => {
        if (result.status === 'rejected') throw result.reason;
        if (retirementScope === 'session' && retiredGeneration === generation)
          sessionRetirementPending = false;
      })
      .catch((error: unknown) => {
        retirementFailed = true;
        throw error;
      });
    fireAndForget(
      retiring.catch(() => {}),
      'crm.access.retirement'
    );
  };
  const observeAuthority = (next: CacheAuthority) => {
    const denied = next.policy?.endsWith(':denied') === true;
    const accountChanged =
      observedAccount != null && observedAccount !== next.account;
    const previousTeam = observedPolicy?.split(':')[0];
    const scopeChanged =
      previousTeam &&
      previousTeam !== 'none' &&
      next.policy != null &&
      previousTeam !== next.policy.split(':')[0];
    const mustRetire =
      accountChanged ||
      scopeChanged ||
      retirementFailed ||
      (denied && (observedPolicy !== next.policy || retirementFailed));
    observedGeneration = next.generation;
    observedPolicy = next.policy;
    observedAccount = next.account;
    if (denied || next.policy === 'none') setState('denied');
    else if (accountChanged) setState('pending');
    if (mustRetire)
      retire(next.generation, accountChanged ? 'session' : 'permission');
  };
  const observe = () => {
    stopObserving?.();
    const observedOwner = owner;
    stopObserving = owner.onChanged((next) => {
      if (owner === observedOwner) observeAuthority(next);
    });
  };
  observe();

  async function prepare(): Promise<CrmRequestAuthority> {
    const context = Telemetry.captureContext();
    const capturedSession = session;
    const capturedOwner = owner;
    if (!account) throw new StaleCacheAuthorityError();
    let state = await capturedOwner.current();
    if (capturedSession !== session || capturedOwner !== owner)
      throw new StaleCacheAuthorityError();
    const bindAccount = options.bindAccount;
    const expectedAccount = account;
    if (state.account && state.account !== expectedAccount)
      retire(state.generation, 'session');
    if (state.account !== expectedAccount && bindAccount) {
      await context.run(() =>
        bindAccount(capturedOwner, state.generation, expectedAccount)
      );
      state = await capturedOwner.current();
    }
    if (
      capturedSession !== session ||
      capturedOwner !== owner ||
      (state.account && state.account !== account)
    )
      throw new StaleCacheAuthorityError();
    observeAuthority(state);
    return {
      owner: capturedOwner,
      generation: state.generation,
      session: capturedSession,
    };
  }
  async function assertCurrent(captured: CrmRequestAuthority): Promise<void> {
    if (captured.session !== session || captured.owner !== owner || !account)
      throw new StaleCacheAuthorityError();
    const current =
      captured.owner.snapshot() ?? (await captured.owner.current());
    if (captured.session !== session || captured.owner !== owner || !account)
      throw new StaleCacheAuthorityError();
    observeAuthority(current);
    if (
      captured.session !== session ||
      captured.owner !== owner ||
      retirementFailed ||
      observedGeneration !== current.generation ||
      !current.ready ||
      !isCrmPolicy(current.policy) ||
      current.generation !== captured.generation ||
      (current.account && current.account !== account)
    )
      throw new StaleCacheAuthorityError();
  }
  async function accept(
    captured: CrmRequestAuthority,
    policy: string
  ): Promise<CrmRequestAuthority> {
    return Telemetry.span(
      'crm.access.accept',
      { sampling: 'perf' },
      async (span) => {
        if (
          !isCrmPolicy(policy) ||
          captured.session !== session ||
          captured.owner !== owner
        )
          throw new StaleCacheAuthorityError();
        const result = await span.span(
          'crm.access.owner_transition',
          async () => captured.owner.transition(captured.generation, policy)
        );
        if (captured.session !== session || captured.owner !== owner)
          throw new StaleCacheAuthorityError();
        span.setAttr('crm.access.changed', result.changed);
        span.run(() => observeAuthority(result.authority));
        const admitted = {
          ...captured,
          generation: result.authority.generation,
        };
        await retiring;
        await span.run(() => assertCurrent(admitted));
        span.setAttr('crm.access.outcome', 'verified');
        verifiedProof = admitted;
        setState(policy.endsWith(':allowed') ? 'allowed' : 'denied');
        options.verified?.();
        for (const listener of verifiedListeners) listener();
        return admitted;
      }
    );
  }
  function refresh(): Promise<CrmRequestAuthority> {
    if (pending?.session === session && pending.owner === owner)
      return pending.promise;
    if (state() === 'error') setState('pending');
    const capturedSession = session;
    const capturedOwner = owner;
    const entry = {
      session,
      owner,
      promise: Promise.resolve(undefined as unknown as CrmRequestAuthority),
    };
    entry.promise = Telemetry.span(
      'crm.access.refresh',
      { sampling: 'perf' },
      async (span) => {
        // A concurrent owner change can overtake preparation or win the proof
        // CAS, or the network can fail transiently. Retry once with a shorter
        // deadline without replacing the last proven UI state.
        for (let attempt = 0; ; attempt++) {
          let networkFailure = false;
          try {
            const captured = await span.span('crm.access.prepare', async () =>
              prepare()
            );
            const policy = await span.span('crm.access.proof', async () => {
              try {
                return await options.fetchProof(attempt === 0 ? 15_000 : 3_000);
              } catch (error) {
                networkFailure = error instanceof TypeError;
                throw error;
              }
            });
            span.setAttr('crm.access.attempt', attempt + 1);
            return await span.run(() => accept(captured, policy));
          } catch (error) {
            if (
              retirementFailed ||
              (!networkFailure &&
                !(error instanceof StaleCacheAuthorityError)) ||
              attempt === 1 ||
              capturedSession !== session ||
              capturedOwner !== owner
            )
              throw error;
            if (networkFailure) await sleep(250);
            if (capturedSession !== session || capturedOwner !== owner)
              throw error;
          }
        }
      }
    )
      .catch((error: unknown) => {
        if (
          capturedSession === session &&
          capturedOwner === owner &&
          state() === 'pending'
        )
          setState('error');
        throw error;
      })
      .finally(() => {
        if (pending === entry) pending = undefined;
      });
    pending = entry;
    return entry.promise;
  }
  async function ensureCurrent(): Promise<CrmRequestAuthority> {
    try {
      const captured = verifiedProof ?? (await prepare());
      await retiring;
      await assertCurrent(captured);
      verifiedProof = captured;
      const policy = owner.snapshot()?.policy;
      if (isCrmPolicy(policy))
        setState(policy.endsWith(':allowed') ? 'allowed' : 'denied');
      return captured;
    } catch (error) {
      if (!(error instanceof StaleCacheAuthorityError)) throw error;
      return refresh();
    }
  }
  return {
    allowed,
    state,
    ensureCurrent,
    captureSession() {
      const captured = loginGeneration;
      return () => {
        if (!account || captured !== loginGeneration)
          throw new StaleCacheAuthorityError();
      };
    },
    prepare,
    accept,
    refresh,
    assertCurrent,
    onSessionChanged(callback: () => void) {
      sessionListeners.add(callback);
      return () => {
        sessionListeners.delete(callback);
      };
    },
    onVerified(callback: () => void) {
      verifiedListeners.add(callback);
      return () => {
        verifiedListeners.delete(callback);
      };
    },
    account: () => account,
    snapshot: () => owner.snapshot(),
    setHost(next: CacheAuthorityHost | undefined) {
      if (next === shared) return;
      shared = next;
      owner = next ?? memoryAuthority(account);
      session += 1;
      setState('pending');
      verifiedProof = undefined;
      observedGeneration = undefined;
      observedPolicy = undefined;
      observedAccount = undefined;
      observe();
      next?.setReadGuard(ensureCurrent);
      for (const listener of sessionListeners) listener();
    },
    setSession(next: string | undefined, epoch = 0) {
      if (next === account && epoch === loginEpoch) return;
      const replacingSession = account !== undefined;
      account = next;
      loginEpoch = epoch;
      loginGeneration += 1;
      session += 1;
      setState('pending');
      verifiedProof = undefined;
      observedGeneration = undefined;
      observedPolicy = undefined;
      observedAccount = undefined;
      if (replacingSession) retire(`session:${session}`, 'session');
      if (!shared) {
        owner = memoryAuthority(account);
        observe();
      }
      for (const listener of sessionListeners) listener();
    },
  };
}

let fetchProof: (timeoutMs: number) => Promise<string> = async () => {
  throw new Error('CRM permission proof is unavailable');
};
let retire: (scope: CrmRetirementScope) => Promise<void> = async () => {};
let verified = () => {};
let bindAccount: (
  owner: CacheAuthorityHost,
  generation: string,
  account: string
) => Promise<void> = async () => {};
export const crmAccessAuthority = createCrmAccessAuthority({
  fetchProof: (timeoutMs) => fetchProof(timeoutMs),
  retire: (scope) => retire(scope),
  verified: () => verified(),
  bindAccount: (...args) => bindAccount(...args),
});
export const crmAccessAllowed = crmAccessAuthority.allowed;
export const crmAccessState = crmAccessAuthority.state;
export function configureCrmAccessAuthority(options: {
  fetchProof: (timeoutMs: number) => Promise<string>;
  retire: (scope: CrmRetirementScope) => Promise<void>;
  verified?: () => void;
  bindAccount?: (
    owner: CacheAuthorityHost,
    generation: string,
    account: string
  ) => Promise<void>;
}) {
  fetchProof = options.fetchProof;
  retire = options.retire;
  verified = options.verified ?? (() => {});
  bindAccount = options.bindAccount ?? (async () => {});
}
