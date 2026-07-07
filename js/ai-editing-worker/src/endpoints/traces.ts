import { Hono } from 'hono';
import { type Bindings, getEnv } from '../env';
import { listEditTraces } from '../traces-db';

/** Constant-time compare so we don't leak the key through response timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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
  if (!token || !safeEqual(token, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

traces.get('/:documentId', async (c) => {
  const db = c.env.TRACES_DB;
  if (!db) return c.json({ error: 'traces db not bound' }, 503);
  const documentId = c.req.param('documentId');
  const rows = await listEditTraces(db, documentId);
  return c.json({ documentId, count: rows.length, traces: rows });
});

export default traces;
