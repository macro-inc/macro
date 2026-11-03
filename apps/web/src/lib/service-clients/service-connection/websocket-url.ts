import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { ensureFreshSession } from '@core/util/fetchWithToken';
import { getMacroApiToken } from '@service-auth/fetch';

/** Resolve gateway credentials without initializing a connection. */
export async function resolveWsUrl() {
  const wsHost = SERVER_HOSTS['connection-gateway'];
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const apiToken = await getMacroApiToken();
    if (!apiToken) throw new Error('No Macro API token');

    return `${wsHost}?macro-api-token=${apiToken}`;
  }
  await ensureFreshSession();
  return wsHost;
}
