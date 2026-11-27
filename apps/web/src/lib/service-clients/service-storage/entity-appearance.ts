import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { dssFetch } from './client';
import type { EntityAppearance } from './generated/schemas/entityAppearance';

export type AppearanceEntityType =
  | 'document'
  | 'initiative'
  | 'form'
  | 'database'
  | 'scheduled_action'
  | 'saved_view';

/** Owning services authorize the same shared, atomic appearance payload. */
export function setEntityAppearance(
  type: AppearanceEntityType,
  id: string,
  appearance: EntityAppearance
) {
  const path = {
    document: 'documents',
    initiative: 'initiatives',
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
