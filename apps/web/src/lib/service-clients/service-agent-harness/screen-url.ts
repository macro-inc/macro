import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { ensureFreshSession } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import { getMacroApiToken } from '@service-auth/fetch';

export async function resolveScreenUrl(
  harnessId: string,
  control: boolean
): Promise<string> {
  return Telemetry.span('computer.screen.connect', async (span) => {
    span.setAttr('harness.id', harnessId);
    span.setAttr('screen.control', control);
    const url = new URL(
      `${SERVER_HOSTS['agent-harness']}/harnesses/${encodeURIComponent(harnessId)}/screen`
    );
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    if (control) url.searchParams.set('control', 'true');
    if (ENABLE_BEARER_TOKEN_AUTH) {
      const token = await getMacroApiToken();
      if (!token) throw new Error('No Macro API token');
      url.searchParams.set('macro-api-token', token);
    } else {
      const refreshed = await ensureFreshSession();
      if (refreshed.isErr())
        throw new Error('Unable to refresh screen session');
    }
    const trace = span.traceparent();
    if (trace) url.searchParams.set('traceparent', trace);
    return url.toString();
  });
}
