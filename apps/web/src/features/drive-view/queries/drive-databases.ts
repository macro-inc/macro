import type { DatabaseEntity } from '@entity';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { DriveSelection } from '../context/drive-source';

/**
 * Databases have no folder membership or view history; list them in file tabs.
 * `hidden` names databases made for a form kept out of Drive, like a poll's.
 */
export function selectDriveDatabases(
  listed: readonly ListedDatabase[],
  selection: DriveSelection,
  userId: string | undefined,
  hidden: ReadonlySet<string>
): DatabaseEntity[] {
  const { location, scope } = selection;
  if (!userId || location.kind !== 'tab' || location.tab === 'recent')
    return [];
  if (scope === 'attachments') return [];

  const search = selection.search.trim().toLocaleLowerCase();
  return listed.flatMap(({ database, grant }) => {
    if (database.trashed_at || hidden.has(database.id)) return [];
    if (location.tab === 'shared' && database.owner_id === userId) return [];
    if (
      location.tab === 'owned' &&
      scope === 'default' &&
      database.owner_id !== userId
    )
      return [];
    if (search && !database.name.toLocaleLowerCase().includes(search))
      return [];
    return [
      {
        type: 'database',
        id: database.id,
        name: database.name,
        ownerId: database.owner_id,
        createdAt: database.created_at,
        grant,
      },
    ];
  });
}
