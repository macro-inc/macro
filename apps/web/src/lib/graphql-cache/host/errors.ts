import type { CacheRequest } from '../protocol';

/** Why a host refused a request itself; a cache response's code is on the wire. */
type CacheHostErrorCode = 'host-disposed' | 'host-failed' | 'request-timeout';

/**
 * The page dropped this host before it answered. The database is kept, so a
 * host built later finds what this one queued.
 */
export class CacheHostDisposedError extends Error {
  readonly errorCode: CacheHostErrorCode = 'host-disposed';

  constructor() {
    super('cache worker host was disposed');
    this.name = 'CacheHostDisposedError';
  }
}

/** The host's workers or their connection failed. The database is kept, so
 * another host may open it. */
export class CacheHostFailedError extends Error {
  readonly errorCode: CacheHostErrorCode = 'host-failed';

  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = 'CacheHostFailedError';
  }
}

/** Nobody answered in time. The database is kept. */
export class CacheRequestTimeoutError extends Error {
  readonly errorCode: CacheHostErrorCode = 'request-timeout';

  constructor(request: CacheRequest['kind'] | 'registration') {
    super(`cache worker timeout: ${request}`);
    this.name = 'CacheRequestTimeoutError';
  }
}
