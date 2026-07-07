import { Hono } from 'hono';
import { type Bindings, getEnv } from '../env';
import { listEditTraces } from '../traces-db';

const traces = new Hono<{ Bindings: Bindings }>();

// Every trace holds full document content, so the whole surface is gated behind
// a single shared admin key (`Authorization: Bearer <TRACE_ADMIN_KEY>`).
traces.use('*', async (c, next) => {
  const expected = getEnv(c.env).TRACE_ADMIN_KEY;
  if (!expected) {
    return c.json({ error: 'traces endpoint not configured' }, 503);
  }
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  if (!token || token !== expected) {
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

export default traces;
