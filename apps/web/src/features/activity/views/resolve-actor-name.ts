import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import type { Accessor } from 'solid-js';

export function useActorDisplayName(
  actorId: Accessor<string>
): Accessor<string> {
  const userId = useUserId();
  const id = tryMacroId(actorId());
  const [remoteName] = useDisplayName(id, { emailFallback: 'local-part' });

  return () => {
    if (!id) return 'Automation';
    if (actorId() === userId()) return 'You';
    return remoteName();
  };
}
