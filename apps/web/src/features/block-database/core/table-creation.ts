export type TableCreationResult =
  | { tableId: string; ready: true }
  | { tableId: string; ready: false; message: string };

export type CreateTable = (
  name: string,
  existingTableId?: string
) => Promise<TableCreationResult>;
