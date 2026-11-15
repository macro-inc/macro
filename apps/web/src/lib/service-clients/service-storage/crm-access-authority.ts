import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';

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
  fetchProof: () => Promise<string>;
  retire: () => Promise<void>;
  verified?: () => void;
  bindAccount?: (
    owner: CacheAuthorityHost,
    generation: string,
    account: string
  ) => Promise<void>;
}) {
  const [allowed, setAllowed] = createSignal(false);
  let account: string | undefined;
  let loginEpoch = 0;
  let session = 0;
  let shared: CacheAuthorityHost | undefined;
  let owner = memoryAuthority();
  let stopObserving: (() => void) | undefined;
  let observedGeneration: string | undefined;
  let retiring = Promise.resolve();
  let retirementFailed = false;
  const sessionListeners = new Set<() => void>();
  const verifiedListeners = new Set<() => void>();
  let pending:
    | {
        session: number;
        owner: CacheAuthorityHost;
        promise: Promise<CrmRequestAuthority>;
      }
    | undefined;

  const retire = (generation: string) => {
    if (observedGeneration === generation && !retirementFailed) return;
    observedGeneration = generation;
    setAllowed(false);
    retirementFailed = false;
    // The callback fences visible observers synchronously, before its disk work.
    const previous = retiring.catch(() => {});
    const work = Telemetry.span('crm.access.visible_retirement', async () =>
      options.retire()
    );
    retiring = Promise.all([previous, work])
      .then(() => {})
      .catch((error: unknown) => {
        retirementFailed = true;
        throw error;
      });
    fireAndForget(
      retiring.catch(() => {}),
      'crm.access.retirement'
    );
  };
  const observe = () => {
    stopObserving?.();
    const observedOwner = owner;
    stopObserving = owner.onChanged((next) => {
      if (owner === observedOwner) retire(next.generation);
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
    return {
      owner: capturedOwner,
      generation: state.generation,
      session: capturedSession,
    };
  }
  async function assertCurrent(captured: CrmRequestAuthority): Promise<void> {
    if (captured.session !== session || captured.owner !== owner || !account)
      throw new StaleCacheAuthorityError();
    const current = await captured.owner.current();
    if (
      captured.session !== session ||
      captured.owner !== owner ||
      retirementFailed ||
      observedGeneration !== current.generation ||
      !current.ready ||
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
        span.setAttr('crm.access.changed', result.changed);
        span.run(() => retire(result.authority.generation));
        const admitted = {
          ...captured,
          generation: result.authority.generation,
        };
        await retiring;
        await span.run(() => assertCurrent(admitted));
        span.setAttr('crm.access.outcome', 'verified');
        setAllowed(policy.endsWith(':allowed'));
        options.verified?.();
        for (const listener of verifiedListeners) listener();
        return admitted;
      }
    );
  }
  function refresh(): Promise<CrmRequestAuthority> {
    if (pending?.session === session && pending.owner === owner)
      return pending.promise;
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
        // CAS. Retry the full read and primary proof without relabelling old data.
        for (let attempt = 0; ; attempt++) {
          try {
            const captured = await span.span('crm.access.prepare', async () =>
              prepare()
            );
            const policy = await span.span('crm.access.proof', async () =>
              options.fetchProof()
            );
            span.setAttr('crm.access.attempt', attempt + 1);
            return await span.run(() => accept(captured, policy));
          } catch (error) {
            if (
              !(error instanceof StaleCacheAuthorityError) ||
              attempt === 1 ||
              capturedSession !== session ||
              capturedOwner !== owner
            )
              throw error;
          }
        }
      }
    )
      .catch((error: unknown) => {
        if (capturedSession === session) {
          setAllowed(false);
          if (!retirementFailed) {
            session += 1;
            retire(`unknown:${session}`);
          }
        }
        throw error;
      })
      .finally(() => {
        if (pending === entry) pending = undefined;
      });
    pending = entry;
    return entry.promise;
  }
  return {
    allowed,
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
      setAllowed(false);
      observedGeneration = undefined;
      retire(`host:${session}`);
      observe();
      next?.setReadGuard(refresh);
      for (const listener of sessionListeners) listener();
    },
    setSession(next: string | undefined, epoch = 0) {
      if (next === account && epoch === loginEpoch) return;
      account = next;
      loginEpoch = epoch;
      session += 1;
      setAllowed(false);
      observedGeneration = undefined;
      retire(`session:${session}`);
      if (!shared) {
        owner = memoryAuthority(account);
        observe();
      }
      for (const listener of sessionListeners) listener();
    },
  };
}

let fetchProof = async (): Promise<string> => {
  throw new Error('CRM permission proof is unavailable');
};
let retire = async () => {};
let verified = () => {};
let bindAccount: (
  owner: CacheAuthorityHost,
  generation: string,
  account: string
) => Promise<void> = async () => {};
export const crmAccessAuthority = createCrmAccessAuthority({
  fetchProof: () => fetchProof(),
  retire: () => retire(),
  verified: () => verified(),
  bindAccount: (...args) => bindAccount(...args),
});
export const crmAccessAllowed = crmAccessAuthority.allowed;
export function configureCrmAccessAuthority(options: {
  fetchProof: () => Promise<string>;
  retire: () => Promise<void>;
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
