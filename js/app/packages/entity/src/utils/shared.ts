import type { EntityData } from '../types/entity';
import { useUserContext } from '@core/context/user';

export function useIsShared(entity: EntityData) {
  const { userId } = useUserContext();
  return () => {
    if (entity.type === 'channel') return false;
    if (entity.ownerId === userId()) return false;
    return true;
  };
}
