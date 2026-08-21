import { useUserContext } from '@core/context/user';
import type { EntityData } from '../types/entity';

export function useIsShared(entity: EntityData) {
  const { userId } = useUserContext();
  return () => {
    if (entity.type === 'channel') return false;
    if (entity.type === 'call') return false;
    if (entity.type === 'foreign') return entity.storedForId !== userId();
    if (entity.type === 'crm_company') return false;
    // A reminder is private to whoever set it, and the API only ever returns
    // the caller's own, so it carries no ownerId at all — without this the
    // undefined would never match and every reminder would read as shared.
    if (entity.type === 'reminder') return false;
    if (entity.ownerId === userId()) return false;
    return true;
  };
}
