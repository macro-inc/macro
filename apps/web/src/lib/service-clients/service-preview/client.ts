import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

/** Wire contract with agent_preview::domain::Preview. No credentials in snapshots. */
export type AgentPreview = {
  id: string;
  agentSessionId: string;
  url: string;
  status: 'starting' | 'ready' | 'offline' | 'expired' | 'stopped';
  expiresAt: number;
};
export type PreviewLaunch = { action: string; ticket: string };
const host = SERVER_HOSTS.preview;

export const previewServiceClient = {
  get(sessionId: string) {
    return fetchWithToken<{ preview: AgentPreview | null }>(
      `${host}/agent-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET' }
    );
  },
  open(sessionId: string) {
    return fetchWithToken<PreviewLaunch>(
      `${host}/agent-sessions/${encodeURIComponent(sessionId)}/open`,
      { method: 'POST' }
    );
  },
  stop(sessionId: string) {
    return fetchWithToken<Record<string, never>>(
      `${host}/agent-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' }
    );
  },
};
