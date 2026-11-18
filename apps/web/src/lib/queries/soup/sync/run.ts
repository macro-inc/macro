/**
 * Starts one streamed sync run on a cache host. The server plans the pass's
 * lanes from the cache's saved lane state, which the host sends with the
 * request; the host opens the stream and writes it. This module only names
 * the pass and reads the outcome.
 */
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import type {
  SyncHost,
  SyncPass,
  SyncRunOutcome,
} from '@graphql-cache/sync-protocol';
import { getMacroApiToken } from '@service-auth/fetch';
import { mailCacheProfile } from '@service-storage/mail-cache-profile';

/** Sibling of the `/items/soup/graphql` endpoint the GraphQL transport uses. */
export function syncStreamUrl(): string {
  return `${SERVER_HOSTS['document-storage-service']}/items/soup/graphql/stream`;
}

/** The GraphQL transport's mail profile and, when it uses one, bearer token. */
export async function syncRequestHeaders(): Promise<Record<string, string>> {
  const mail = await mailCacheProfile();
  const headers: Record<string, string> = {
    'x-macro-mail-cache-profile': mail.profile,
  };
  if (ENABLE_BEARER_TOKEN_AUTH) {
    headers.authorization = `Bearer ${await getMacroApiToken()}`;
  }
  return headers;
}

export type SyncPassOptions = {
  /** Sync calendar windows (default true); off while calendars read REST. */
  calendar?: boolean;
  /**
   * Leave out lanes that completed at or after this ISO time: they are
   * current for this run. Retries and second-pass chunks pass their start.
   */
  completedSince?: string;
  /**
   * Lanes to leave out: they failed too often in this pass and resume from
   * their saved state on the next one.
   */
  skipLanes?: ReadonlySet<string>;
  /** End the stream after this many pages; the next stream resumes. */
  maxPages?: number;
};

/** The time zone the app reads calendar months and dates in. */
function appTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Runs one stream of `pass`, sending `traceHeaders` (the caller's trace
 * context) with the request. A pass with nothing left to sync ends complete.
 */
export async function runSyncPass(
  host: SyncHost,
  pass: SyncPass,
  options: SyncPassOptions = {},
  traceHeaders: Record<string, string> = {}
): Promise<SyncRunOutcome> {
  return host.syncStart({
    url: syncStreamUrl(),
    headers: { ...(await syncRequestHeaders()), ...traceHeaders },
    pass,
    ...(options.calendar === false
      ? {}
      : { calendar: { timeZone: appTimeZone() } }),
    ...(options.completedSince === undefined
      ? {}
      : { completedSince: options.completedSince }),
    ...(options.skipLanes?.size ? { skipLanes: [...options.skipLanes] } : {}),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
  });
}
