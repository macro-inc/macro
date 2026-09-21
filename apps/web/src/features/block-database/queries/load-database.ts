import { storageServiceClient } from '@service-storage/client';

/** Load transport only when opening a database, not while discovering block types. */
export function loadDatabase(id: string) {
  return storageServiceClient.databases.get({ id });
}
