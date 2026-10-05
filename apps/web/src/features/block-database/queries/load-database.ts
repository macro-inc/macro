import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';

/** The block's view of a database: its grant is the viewer's access level. */
type LoadedDatabase = DatabaseDetail & { userAccessLevel: AccessLevel };

/** Load transport only when opening a database, not while discovering block types. */
export async function loadDatabase(id: string) {
  const result = await storageServiceClient.databases.get({ id });
  return result.map(
    (detail): LoadedDatabase => ({ ...detail, userAccessLevel: detail.grant })
  );
}
