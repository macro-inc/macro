import type { Accessor } from 'solid-js';
import type { ActivityDeps } from '../deps';

/** "You" for the viewer, "Automation" for non-user actors, else the name. */
export function createActorName(
  deps: Pick<ActivityDeps, 'currentUserId' | 'displayName'>,
  actorId: Accessor<string>
): Accessor<string> {
  const remote = deps.displayName(actorId);
  return () => {
    const name = remote();
    if (name === undefined) return 'Automation';
    if (actorId() === deps.currentUserId()) return 'You';
    return name;
  };
}
