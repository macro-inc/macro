import type {
  AuthorityTransition,
  CacheAuthority,
} from './authority.generated';
import { CacheAuthoritySchema } from './authority.generated';

export type {
  AuthorityAdmission,
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
  /** The application verifies the current generation, reusing durable proof when possible. */
  setReadGuard(guard: () => Promise<unknown>): void;
  verifyRead(): Promise<void>;
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
  let verified = false;
  const listeners = new Set<(authority: CacheAuthority) => void>();
  return {
    snapshot: () => current,
    version: () => version,
    verified: () => verified,
    verify() {
      verified = true;
    },
    invalidateProof() {
      verified = false;
    },
    observe(value: unknown, expectedVersion = version) {
      const next = parseCacheAuthority(value);
      if (next.identity !== identity) throw new StaleCacheAuthorityError();
      if (
        expectedVersion !== version &&
        current?.generation !== next.generation
      )
        throw new StaleCacheAuthorityError();
      const changed =
        current?.generation !== next.generation || current.ready !== next.ready;
      current = next;
      if (changed) {
        version += 1;
        verified = false;
        for (const listener of listeners) listener(next);
      }
      return next;
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
      verified = false;
    },
  };
}

/** Rust admission errors cross IPC as strings. Keep their retry semantics. */
export function cacheAuthorityError(error: unknown): Error {
  const value = error instanceof Error ? error : new Error(String(error));
  return value.message.includes(
    'cache authority changed; obtain a new permission proof'
  )
    ? new StaleCacheAuthorityError()
    : value;
}
