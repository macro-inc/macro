/**
 * Handover of the cache database between app builds.
 *
 * Each build runs its own coordinator, because the coordinator's script URL is
 * content-hashed, yet every build of a scope shares one database. When a
 * newer build finds the database held by an older one, it asks on this
 * channel. The holder either yields, closing the database and telling its
 * tabs to reload into the newer build, or keeps it.
 *
 * Builds answer each other across releases, so the channel name and these
 * message shapes must never change. Extend them only with fields that older
 * builds may ignore, or add a new `takeover` version beside this one.
 */
export const CACHE_TAKEOVER_VERSION = 1;

export const cacheTakeoverChannelName = (scope: string): string =>
  `graphql-cache-takeover:${scope}`;

export type CacheTakeoverRequest = {
  takeover: typeof CACHE_TAKEOVER_VERSION;
  kind: 'request';
  scope: string;
  requestId: string;
  /** The requesting build's time; only a strictly newer build is yielded to. */
  buildTime: number;
};

export type CacheTakeoverReply = {
  takeover: typeof CACHE_TAKEOVER_VERSION;
  kind: 'reply';
  scope: string;
  requestId: string;
  /** Sent only by the build whose engine holds the database. */
  decision: 'yield' | 'keep';
};

export type CacheTakeoverMessage = CacheTakeoverRequest | CacheTakeoverReply;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Reads a message from any build. Unknown fields are ignored, not rejected,
 * so later builds can add them. */
export function parseCacheTakeoverMessage(
  value: unknown
): CacheTakeoverMessage | undefined {
  if (
    !isRecord(value) ||
    value.takeover !== CACHE_TAKEOVER_VERSION ||
    !isNonEmptyString(value.scope) ||
    !isNonEmptyString(value.requestId)
  ) {
    return;
  }
  const { scope, requestId } = value;
  if (
    value.kind === 'request' &&
    Number.isSafeInteger(value.buildTime) &&
    (value.buildTime as number) >= 0
  ) {
    return {
      takeover: CACHE_TAKEOVER_VERSION,
      kind: 'request',
      scope,
      requestId,
      buildTime: value.buildTime as number,
    };
  }
  if (
    value.kind === 'reply' &&
    (value.decision === 'yield' || value.decision === 'keep')
  ) {
    return {
      takeover: CACHE_TAKEOVER_VERSION,
      kind: 'reply',
      scope,
      requestId,
      decision: value.decision,
    };
  }
}

export interface CacheTakeoverChannel {
  post(message: CacheTakeoverMessage): void;
  close(): void;
}

/** Opens the scope's takeover channel, or returns undefined where the
 * browser has no BroadcastChannel; builds then never hand over. */
export function openCacheTakeoverChannel(
  scope: string,
  onMessage: (message: CacheTakeoverMessage) => void
): CacheTakeoverChannel | undefined {
  if (typeof BroadcastChannel !== 'function') return;
  const channel = new BroadcastChannel(cacheTakeoverChannelName(scope));
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = parseCacheTakeoverMessage(event.data);
    if (message?.scope === scope) onMessage(message);
  };
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}
