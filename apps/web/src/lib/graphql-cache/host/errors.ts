import type { CacheRequest } from '../protocol';

/** Why a host refused a request itself; a cache response's code is on the wire. */
type CacheHostErrorCode =
  | 'host-disposed'
  | 'host-failed'
  | 'request-timeout'
  | 'settlement-unwritten';

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

/**
 * A queue settlement reached a host with no engine, through a host that
 * retired after its head was claimed. Nothing was written: the head stays
 * queued under that claim, which only an engine may say it settled.
 */
export class CacheSettlementUnwrittenError extends Error {
  readonly errorCode: CacheHostErrorCode = 'settlement-unwritten';

  constructor() {
    super('the cache has no engine to write this settlement');
    this.name = 'CacheSettlementUnwrittenError';
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

/** What the native engine says when it refuses a background write. */
const NATIVE_WRITE_SUPERSEDED =
  'graphql cache write superseded by a committed mutation';

/**
 * A foreground write, such as a mutation's commit, went ahead of this
 * background write and stored a different value for one of its fields, so the
 * response may predate it. Nothing was written; fetch the query again.
 */
export class CacheWriteSupersededError extends Error {
  constructor() {
    super('cache write superseded by a committed mutation');
    this.name = 'CacheWriteSupersededError';
  }
}

export function isNativeWriteSuperseded(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes(
    NATIVE_WRITE_SUPERSEDED
  );
}
