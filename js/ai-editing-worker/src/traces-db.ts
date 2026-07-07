// The narrow slice of the Cloudflare D1 API we use, declared locally so this
// worker doesn't need `@cloudflare/workers-types` wired into its tsconfig.
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

export type EditTrace = {
  id: string;
  document_id: string;
  created_at: number;
  markdown: string;
};

export async function insertEditTrace(
  db: D1Database,
  trace: EditTrace
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO edit_traces (id, document_id, created_at, markdown) VALUES (?, ?, ?, ?)'
    )
    .bind(trace.id, trace.document_id, trace.created_at, trace.markdown)
    .run();
}

/** All traces for a document, newest first. */
export async function listEditTraces(
  db: D1Database,
  documentId: string
): Promise<EditTrace[]> {
  const { results } = await db
    .prepare(
      'SELECT id, document_id, created_at, markdown FROM edit_traces WHERE document_id = ? ORDER BY created_at DESC'
    )
    .bind(documentId)
    .all<EditTrace>();
  return results;
}
