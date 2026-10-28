import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithAuth } from './fetch';
import type { PatchTeamCrmSettingsRequest } from './generated/schemas/patchTeamCrmSettingsRequest';
import type { PatchTeamCrmSettingsResponse } from './generated/schemas/patchTeamCrmSettingsResponse';

/** Authenticated counterpart of the generated relative-URL endpoint. */
export function patchTeamCrmSettings(body: PatchTeamCrmSettingsRequest) {
  return fetchWithAuth<PatchTeamCrmSettingsResponse>(
    `${SERVER_HOSTS['auth-service']}/team/crm`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}
