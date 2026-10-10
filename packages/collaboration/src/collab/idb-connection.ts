import {
  type DBSchema,
  type IDBPDatabase,
  type OpenDBCallbacks,
  openDB,
} from 'idb';

/**
 * Returns a getter for one shared connection to an IndexedDB database. The
 * browser can close a connection on its own (backing-store failure, site data
 * cleared) and every later transaction on it throws "The database connection
 * is closing", so a closed or failed connection is dropped and the next call
 * opens a new one.
 */
export function reconnectingDB<S extends DBSchema>(
  name: string,
  version: number,
  upgrade: OpenDBCallbacks<S>['upgrade']
): () => Promise<IDBPDatabase<S>> {
  let connection: Promise<IDBPDatabase<S>> | undefined;
  const forget = (stale: Promise<IDBPDatabase<S>>) => {
    if (connection === stale) connection = undefined;
  };
  const open = (): Promise<IDBPDatabase<S>> => {
    const opening = openDB<S>(name, version, {
      upgrade,
      terminated: () => forget(opening),
    });
    return opening;
  };
  return async () => {
    connection ??= open();
    const current = connection;
    try {
      return await current;
    } catch (error) {
      forget(current);
      throw error;
    }
  };
}
