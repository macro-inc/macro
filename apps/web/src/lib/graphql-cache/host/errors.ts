/** Why a host refused a request itself; a cache response's code is on the wire. */
type CacheHostErrorCode = 'host-disposed';

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
