import type {
  GranolaScope,
  GranolaSyncStatus,
  ImportedMeeting,
  ImportedMeetingRecord,
} from '@app/features/granola-sync/core/types';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

const base = `${SERVER_HOSTS['cognition-service']}/integrations/granola`;

export const granolaSyncClient = {
  status: () => fetchWithToken<GranolaSyncStatus>(base),
  start: (scope: GranolaScope) =>
    fetchWithToken(base, {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),
  stop: () => fetchWithToken(base, { method: 'DELETE' }),
  meetings: () => fetchWithToken<ImportedMeeting[]>(`${base}/meetings`),
  meeting: (id: string) =>
    fetchWithToken<ImportedMeetingRecord>(
      `${base}/meetings/${encodeURIComponent(id)}`
    ),
};
