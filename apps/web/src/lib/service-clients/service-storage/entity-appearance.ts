import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { dssFetch } from './client';
import type { EntityAppearance } from './generated/schemas/entityAppearance';

type NonSoupAppearanceEntityType =
  | 'form'
  | 'database'
  | 'scheduled_action'
  | 'saved_view';

/** Appearance for entities outside the Soup graph. */
export function setOtherEntityAppearance(
  type: NonSoupAppearanceEntityType,
  id: string,
  appearance: EntityAppearance
) {
  const path = {
    form: 'forms',
    database: 'databases',
    scheduled_action: 'scheduled-actions',
    saved_view: 'saved_views/definitions',
  }[type];
  const request = { method: 'PUT' as const, body: JSON.stringify(appearance) };
  const url = `/${path}/${encodeURIComponent(id)}/appearance`;
  if (type === 'scheduled_action') {
    return fetchWithToken(`${SERVER_HOSTS['scheduled-action']}${url}`, request);
  }
  return dssFetch(url, request);
}
