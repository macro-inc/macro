import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

import type {
  CodexConfigRequest,
  CodexConnectionStatus,
  CodexEnvironment,
  CodexLoginPoll,
  CodexLoginStart,
} from './generated/schemas';

export type {
  CodexConfigRequest as CodexConfig,
  CodexLoginStart as CodexLogin,
} from './generated/schemas';

const base = `${SERVER_HOSTS['auth-service']}/codex`;

/** The browser only receives device-flow display data; OAuth tokens stay server-side. */
export const codexClient = {
  status: () => fetchWithToken<CodexConnectionStatus>(base),
  login: () =>
    fetchWithToken<CodexLoginStart>(`${base}/login`, { method: 'POST' }),
  poll: (id: string) =>
    fetchWithToken<CodexLoginPoll>(`${base}/login/${encodeURIComponent(id)}`),
  cancel: (id: string) =>
    fetchWithToken(`${base}/login/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  disconnect: () => fetchWithToken(base, { method: 'DELETE' }),
  environments: () =>
    fetchWithToken<CodexEnvironment[]>(`${base}/environments`),
  configure: (config: CodexConfigRequest) =>
    fetchWithToken<CodexConnectionStatus>(`${base}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
      headers: { 'Content-Type': 'application/json' },
    }),
};
