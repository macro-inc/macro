import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type { ActivityContext } from '../context/activity-context';
import { parseActor } from '../core/actor';

/**
 * The name an activity row shows for its actor. The viewer reads "You",
 * other users read their display name, bots read their bot name (the
 * system principal reads "System"), external actors read "External sender",
 * and ids the app cannot parse read "Unknown". Resolvers are created lazily
 * per actor kind so a user row never subscribes to the bots list.
 */
export function createActorName(
  context: Pick<ActivityContext, 'currentUserId' | 'displayName' | 'botName'>,
  actorId: Accessor<string>
): Accessor<string> {
  const resolver = createMemo<Accessor<string>>(() => {
    const id = actorId();
    if (id === context.currentUserId()) return () => 'You';
    return match(parseActor(id))
      .with({ kind: 'user' }, (actor) => {
        const remote = context.displayName(() => actor.id);
        return () => remote() ?? 'Unknown';
      })
      .with({ kind: 'bot' }, (actor) => {
        const remote = context.botName(() => actor.botId);
        return () => remote() ?? '';
      })
      .with({ kind: 'external' }, () => () => 'External sender')
      .with({ kind: 'unknown' }, () => () => 'Unknown')
      .exhaustive();
  });
  return () => resolver()();
}
