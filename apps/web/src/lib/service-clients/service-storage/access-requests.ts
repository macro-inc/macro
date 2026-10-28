import { dssFetch } from './client';
import type { AccessLevel } from './generated/schemas/accessLevel';
import type { AccessRequest } from './generated/schemas/accessRequest';
import type { AccessRequestState } from './generated/schemas/accessRequestState';
import type { DirectAccess } from './generated/schemas/directAccess';
import type { ShareEntity } from './generated/schemas/shareEntity';

const base = (entity: ShareEntity) =>
  `/entities/${entity.entityType}/${encodeURIComponent(entity.entityId)}`;
export const accessRequestsClient = {
  state: (entity: ShareEntity, offset = 0) =>
    dssFetch<AccessRequestState>(
      `${base(entity)}/access-requests?offset=${offset}`
    ),
  grants: (entity: ShareEntity) =>
    dssFetch<DirectAccess[]>(`${base(entity)}/direct-access`),
  submit: (
    entity: ShareEntity,
    requestedLevel: AccessLevel,
    revision?: number
  ) =>
    dssFetch<AccessRequest>(`${base(entity)}/access-requests/mine`, {
      method: 'PUT',
      body: JSON.stringify({ requestedLevel, revision }),
    }),
  cancel: (entity: ShareEntity, revision: number) =>
    dssFetch(`${base(entity)}/access-requests/mine?revision=${revision}`, {
      method: 'DELETE',
    }),
  resolve: (
    entity: ShareEntity,
    id: string,
    revision: number,
    grantedLevel: AccessLevel | null
  ) =>
    dssFetch<AccessRequest>(`${base(entity)}/access-requests/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ revision, grantedLevel }),
    }),
  setGrant: (
    entity: ShareEntity,
    userId: string,
    accessLevel: AccessLevel | null
  ) =>
    dssFetch(`${base(entity)}/direct-access/${encodeURIComponent(userId)}`, {
      method: accessLevel === null ? 'DELETE' : 'PUT',
      ...(accessLevel === null
        ? {}
        : { body: JSON.stringify({ accessLevel }) }),
    }),
};
