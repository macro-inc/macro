import { Hono } from 'hono';
import { type Bindings, getEnv } from '../env';
import { deleteEditTracesByDocumentId, listEditTraces } from '../traces-db';

const traces = new Hono<{ Bindings: Bindings }>();

// Every trace holds full document content, so the whole surface is gated. Two
// callers are accepted: humans via `Authorization: Bearer <TRACE_ADMIN_KEY>`
// (e.g. the CLI), and internal services via `x-internal-auth-key:
// <INTERNAL_API_KEY>` (e.g. the delete-document worker purging traces).
traces.use('*', async (c, next) => {
  const env = getEnv(c.env);

  const bearer = (c.req.header('Authorization') ?? '').startsWith('Bearer ')
    ? (c.req.header('Authorization') ?? '').slice('Bearer '.length)
    : '';
  const adminOk =
    Boolean(env.TRACE_ADMIN_KEY) && bearer === env.TRACE_ADMIN_KEY;

  const internalKey = c.req.header('x-internal-auth-key') ?? '';
  const internalOk =
    Boolean(env.INTERNAL_API_KEY) && internalKey === env.INTERNAL_API_KEY;

  if (!env.TRACE_ADMIN_KEY && !env.INTERNAL_API_KEY) {
    return c.json({ error: 'traces endpoint not configured' }, 503);
  }
  if (!adminOk && !internalOk) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

traces.get('/:documentId', async (c) => {
  const db = c.env.TRACES_DB;
  if (!db) return c.json({ error: 'traces db not bound' }, 503);
  const documentId = c.req.param('documentId');
  const rows = await listEditTraces(db, documentId);
  const results = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    session: JSON.parse(r.trace_json) as unknown,
  }));
  return c.json({ documentId, count: results.length, traces: results });
});

// Called when a document is deleted so trace records (which hold full document
// content) don't outlive the document.
traces.delete('/:documentId', async (c) => {
  const db = c.env.TRACES_DB;
  if (!db) return c.json({ error: 'traces db not bound' }, 503);
  const documentId = c.req.param('documentId');
  await deleteEditTracesByDocumentId(db, documentId);
  return c.json({ documentId, deleted: true });
});

export default traces;
