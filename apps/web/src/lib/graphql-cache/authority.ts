import type {
  AuthorityTransition,
  CacheAuthority,
} from './authority.generated';
import { CacheAuthoritySchema } from './authority.generated';
import { rememberGeneration } from './generation-mirror';

export type {
  AuthorityTransition,
  CacheAuthority,
} from './authority.generated';

export interface CacheAuthorityHost {
  /** Refresh the shared owner state before dispatching a permission proof. */
  current(): Promise<CacheAuthority>;
  /** The last state observed in this realm; never stamps already acquired data. */
  snapshot(): CacheAuthority | undefined;
  /** Compare a proof to its pre-request generation under the owner lock. */
  transition(expected: string, policy: string): Promise<AuthorityTransition>;
  onChanged(callback: (authority: CacheAuthority) => void): () => void;
}

export class StaleCacheAuthorityError extends Error {
  constructor() {
    super('Cache permission changed; fetch the content again');
    this.name = 'StaleCacheAuthorityError';
  }
}

export function parseCacheAuthority(value: unknown): CacheAuthority {
  return CacheAuthoritySchema.parse(value);
}

/** Host-local observations of owner-issued generations, with no policy authority. */
export function createAuthorityObserver(identity: string) {
  let current: CacheAuthority | undefined;
  let version = 0;
  const listeners = new Set<(authority: CacheAuthority) => void>();
  const observer = {
    snapshot: () => current,
    version: () => version,
    observe(
      value: unknown,
      expectedVersion = version,
      source: 'snapshot' | 'current' | 'transition' = 'snapshot'
    ) {
      const next = parseCacheAuthority(value);
      if (next.identity !== identity) throw new StaleCacheAuthorityError();
      const changed =
        current?.generation !== next.generation ||
        current.ready !== next.ready ||
        current.account !== next.account ||
        current.policy !== next.policy;
      // An owner completion can follow its begin event. A delayed read cannot
      // undo an account witness or readiness already observed in that generation.
      const completesTransition =
        source === 'transition' &&
        current?.generation === next.generation &&
        !current.ready &&
        next.ready &&
        current.account === next.account &&
        current.policy === next.policy;
      if (expectedVersion !== version && changed && !completesTransition) {
        // A current() handshake may race a validated owner push. It can use
        // that newer observation only after validating this reply's protocol
        // and identity; stale proof completions must still reject.
        if (source === 'current' && current) return current;
        throw new StaleCacheAuthorityError();
      }
      current = next;
      rememberGeneration(next);
      if (changed) {
        version += 1;
        for (const listener of listeners) listener(next);
      }
      return next;
    },
    observeCurrent(value: unknown, expectedVersion = version): CacheAuthority {
      return observer.observe(value, expectedVersion, 'current');
    },
    onChanged(callback: (authority: CacheAuthority) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    reset() {
      current = undefined;
      version += 1;
    },
  };
  return observer;
}

/** Rust generation errors cross IPC as strings. Keep their retry semantics. */
export function cacheAuthorityError(error: unknown): Error {
  const value = error instanceof Error ? error : new Error(String(error));
  return value.message.includes(
    'cache authority changed; obtain a new permission proof'
  ) ||
    value.message.includes(
      'cache response belongs to an older session generation'
    )
    ? new StaleCacheAuthorityError()
    : value;
}
