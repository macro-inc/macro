import type { DatabaseSchemaChange } from './column-schema';

export type TableCreationResult =
  | { tableId: string; ready: true }
  | { tableId: string; ready: false; message: string };

/** Creating the table can fail; setting it up afterwards only leaves it unready. */
export type CreateTable = (
  name: string,
  existingTableId?: string
) => DatabaseSchemaChange<TableCreationResult>;
