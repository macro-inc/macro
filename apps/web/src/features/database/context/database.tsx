import { useQueryClient } from '@tanstack/solid-query';
import { createContext, type JSX, useContext } from 'solid-js';
import type { DatabaseApi, DatabaseCapabilities } from '../core/api';
import type { DatabaseViewState } from '../core/view-state';
import {
  createDatabaseController,
  type DatabaseController,
} from '../primitives/database-controller';
import {
  createDatabaseApiSource,
  type DatabaseDataSource,
} from '../queries/api-source';

const DatabaseContext = createContext<DatabaseController>();

/** One editor owns one controller lifetime. Remount it when the resource changes. */
export function DatabaseProvider(props: {
  api: DatabaseApi;
  tableId: string;
  capabilities: DatabaseCapabilities;
  view: DatabaseViewState;
  /** An optimized source may supply SQL caching or inference behind the same editor contract. */
  data?: DatabaseDataSource;
  inferNewColumns?: boolean;
  children: JSX.Element;
}) {
  const client = useQueryClient();
  const data =
    props.data ??
    createDatabaseApiSource({
      api: props.api,
      tableId: props.tableId,
      view: () => props.view,
      client,
    });
  const controller = createDatabaseController({
    api: props.api,
    tableId: props.tableId,
    data,
    capabilities: () => props.capabilities,
    inferNewColumns: props.inferNewColumns,
  });
  return (
    <DatabaseContext.Provider value={controller}>
      {props.children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseController {
  const database = useContext(DatabaseContext);
  if (!database)
    throw new Error('Database components require a DatabaseProvider.');
  return database;
}
