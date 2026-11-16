import { match } from 'ts-pattern';
import { Initiative } from '../../entities/initiatives/initiative';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type InitiativeEvent = Extract<
  MacroEvent,
  { event_type: `initiative.${string}` }
>;

/** Attach the initiative (and acted-for user) handles to an initiative event. */
export function hydrateInitiativeEvent(
  client: MacroClient,
  event: InitiativeEvent,
) {
  return match(event)
    .with(
      { event_type: 'initiative.created' },
      { event_type: 'initiative.updated' },
      { event_type: 'initiative.appearance_changed' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        initiative: Initiative.byId(client, metadata.initiative_id),
        onBehalfOf: metadata.on_behalf_of
          ? User.byId(client, metadata.on_behalf_of)
          : undefined,
      }),
    )
    .with({ event_type: 'initiative.purged' }, ({ metadata }) => ({
      event_type: 'initiative.purged' as const,
      metadata,
      initiative: Initiative.byId(client, metadata.initiative_id),
    }))
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown initiative event', unknown);
      return undefined;
    });
}
