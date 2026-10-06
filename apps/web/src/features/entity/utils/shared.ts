import { useUserContext } from '@core/context/user';
import { match, P } from 'ts-pattern';
import type { EntityData } from '../types/entity';

const OWNER_PRINCIPAL_ROW = [
  'agent_session',
  'routine',
  'calendar_event',
  'chat',
  'database',
  'document',
  'email',
  'initiative',
  'project',
] as const;

const UNSHARED_ROW = [
  'call',
  'channel',
  'channel_message',
  'channel_thread',
  'crm_company',
  'crm_contact',
] as const;

export function isSharedWithViewer(
  entity: EntityData,
  viewerId: string | undefined
): boolean {
  return match(entity)
    .with({ type: P.union(...OWNER_PRINCIPAL_ROW) }, (row) => {
      return Boolean(row.ownerId) && row.ownerId !== viewerId;
    })
    .with({ type: 'foreign' }, (row) => row.storedForId !== viewerId)
    .with({ type: P.union(...UNSHARED_ROW) }, () => false)
    .exhaustive();
}

export function useIsShared(entity: EntityData) {
  const { userId } = useUserContext();
  return () => isSharedWithViewer(entity, userId());
}
