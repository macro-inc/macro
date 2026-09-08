import type { Accessor } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';

/** "You" for the viewer, "Automation" for non-user actors, else the name. */
export function createActorName(
  context: Pick<ActivityContext, 'currentUserId' | 'displayName'>,
  actorId: Accessor<string>
): Accessor<string> {
  const remote = context.displayName(actorId);
  return () => {
    const name = remote();
    if (name === undefined) return 'Automation';
    if (actorId() === context.currentUserId()) return 'You';
    return name;
  };
}
