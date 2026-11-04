/**
 * Starts one streamed sync run on a cache host. The host opens the stream and
 * writes it; this module only builds the request and reads the outcome.
 */
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import type { SyncHost, SyncRunOutcome } from '@graphql-cache/sync-protocol';
import { getMacroApiToken } from '@service-auth/fetch';
import { mailCacheProfile } from '@service-storage/mail-cache-profile';
import type { SyncPass } from './lanes';
import {
  buildSyncLanes,
  type SyncPlanHost,
  type SyncPlanOptions,
} from './plan';

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

export type SyncPassOptions = SyncPlanOptions & { maxPages?: number };

const NOTHING_TO_SYNC: SyncRunOutcome = {
  ok: true,
  result: { reason: 'complete', durationMs: 0, bytes: 0, lanes: [] },
};

/** Plans and runs one stream of `pass`. A plan with no lanes is complete. */
export async function runSyncPass(
  host: SyncPlanHost & SyncHost,
  pass: SyncPass,
  options: SyncPassOptions = {}
): Promise<SyncRunOutcome> {
  const lanes = await buildSyncLanes(host, pass, options);
  if (lanes.length === 0) return NOTHING_TO_SYNC;
  return host.syncStart({
    url: syncStreamUrl(),
    headers: await syncRequestHeaders(),
    lanes,
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
  });
}
