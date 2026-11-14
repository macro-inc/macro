import { fetchDatabaseDetail } from '@queries/storage/databases';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';

/** The block's view of a database: its grant is the viewer's access level. */
type LoadedDatabase = DatabaseDetail & { userAccessLevel: AccessLevel };

/** Load transport only when opening a database, not while discovering block types. */
export async function loadDatabase(id: string) {
  return await fetchDatabaseDetail(id).map(
    (detail): LoadedDatabase => ({ ...detail, userAccessLevel: detail.grant })
  );
}
