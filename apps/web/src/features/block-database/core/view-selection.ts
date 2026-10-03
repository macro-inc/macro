/** The table open in a database, and the view open in each of its tables. */
export type DatabaseViewSelection = {
  tableId?: string;
  views: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Malformed browser state never prevents opening a database. */
export function readViewSelection(
  raw: string | null | undefined
): DatabaseViewSelection | undefined {
  try {
    const stored: unknown = JSON.parse(raw ?? 'null');
    if (!isRecord(stored)) return;
    const views = isRecord(stored.views)
      ? Object.fromEntries(
          Object.entries(stored.views).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {};
    return {
      tableId: typeof stored.tableId === 'string' ? stored.tableId : undefined,
      views,
    };
  } catch {
    return;
  }
}
