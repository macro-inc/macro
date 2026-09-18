/**
 * Gateway liveness for Macro Databases.
 *
 * Kept apart from `./databases` so the query module — which eager modules such
 * as the launcher import — does not pull the connection-gateway websocket into
 * the startup import graph.
 */
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { invalidateDatabase, invalidateDatabaseRows } from './databases';

/** Gateway message type published by `crates/databases` on every write. */
const TABLE_CHANGED_MESSAGE_TYPE = 'database_table_changed';

type TableChangedMessage = {
  databaseId: string;
  tableId: string;
  version: number;
};

/**
 * Re-read a database whenever the gateway reports one of its tables changed.
 *
 * Results are never pushed — the message carries only the table's new version,
 * and every viewer re-executes its own queries as itself.
 */
export function useDatabaseTableChangedSync(
  databaseId: () => string | undefined
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== TABLE_CHANGED_MESSAGE_TYPE) return;

    let data: TableChangedMessage;
    try {
      data =
        typeof message.data === 'string'
          ? JSON.parse(message.data)
          : message.data;
    } catch {
      console.error('unparsable database_table_changed payload', message);
      return;
    }

    if (!data?.databaseId || data.databaseId !== databaseId()) return;

    invalidateDatabase(data.databaseId);
    if (data.tableId) invalidateDatabaseRows(data.databaseId, data.tableId);
  });
}
