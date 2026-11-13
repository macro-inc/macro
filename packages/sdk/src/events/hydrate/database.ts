import { match } from 'ts-pattern';
import { Database } from '../../entities/databases/database';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type DatabaseEvent = Extract<
  MacroEvent,
  { event_type: `database.${string}` }
>;

/** Attach the database handle (and the user acted for) to a database event. */
export function hydrateDatabaseEvent(
  client: MacroClient,
  event: DatabaseEvent,
) {
  const handles = (change: {
    database_id: string;
    on_behalf_of?: string | null;
  }) => ({
    database: Database.byId(client, change.database_id),
    onBehalfOf: change.on_behalf_of
      ? User.byId(client, change.on_behalf_of)
      : undefined,
  });

  return match(event)
    .with(
      { event_type: 'database.created' },
      { event_type: 'database.tables_changed' },
      { event_type: 'database.renamed' },
      { event_type: 'database.trashed' },
      { event_type: 'database.restored' },
      { event_type: 'database.sharing_changed' },
      { event_type: 'database.appearance_changed' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        ...handles(metadata),
      }),
    )
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown database event', unknown);
      return undefined;
    });
}
