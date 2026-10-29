import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import { getMacroApiToken } from '@service-auth/fetch';

/** Resolve fresh account credentials for the dedicated DSS sync socket. */
export async function resolveSyncRouterWsUrl(): Promise<string> {
  return Telemetry.span('sync.router.connect', async (span) => {
    const url = new URL(
      `${SERVER_HOSTS['document-storage-service'].replace(/\/$/, '')}/sync/ws`
    );
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    if (ENABLE_BEARER_TOKEN_AUTH) {
      const token = await getMacroApiToken();
      if (!token) throw new Error('No Macro API token');
      url.searchParams.set('macro-api-token', token);
    } else {
      const refreshed = await fetchToken();
      if (refreshed.isErr()) throw new Error('Unable to refresh sync session');
    }
    const traceparent = span.traceparent();
    if (traceparent) url.searchParams.set('traceparent', traceparent);
    return url.toString();
  });
}
