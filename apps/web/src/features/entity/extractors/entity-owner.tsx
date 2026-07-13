import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import type { EntityData } from '../types/entity';

export function EntityOwner(props: { entity: EntityData }) {
  const userId = useUserId();
  const ownerId = () => props.entity.ownerId;

  const ownerDisplayName = () => {
    const owner = ownerId();
    if (!owner) return undefined;
    return useDisplayName(tryMacroId(owner))[0]();
  };

  const displayText = () => {
    const owner = ownerId();
    const currentUser = userId();

    if (!owner) return undefined;

    if (currentUser && owner === currentUser) {
      return 'me';
    }

    return ownerDisplayName();
  };

  return <>{displayText()}</>;
}
