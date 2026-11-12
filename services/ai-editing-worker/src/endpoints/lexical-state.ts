import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import { readLexicalState } from '../lexical-commit/run';
import { createWorkerSyncSource } from '../sources';

const LexicalStateBody = z.object({
  documentId: z.string().min(1),
  /** A view-level token is enough. */
  documentToken: z.string().min(1),
});

const lexicalState = new Hono<{ Bindings: Bindings }>();

/**
 * Read a markdown document as a normalized Lexical editor state, with the
 * revision it is at, for a program to edit and commit to `/lexical-commit`.
 */
lexicalState.post('/', zValidator('json', LexicalStateBody), async (c) => {
  const env = getEnv(c.env);
  const { documentId, documentToken } = c.req.valid('json');
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(20_000),
  ]);
  try {
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
    const result = await Telemetry.span('edit.lexical_state', async (span) => {
      span.setAttr('document.id', documentId);
      try {
        const result = await readLexicalState(
          createWorkerSyncSource(wsUrl, documentId, signal),
          documentId
        );
        span.setAttr(
          'edit.blocks_total',
          result.state.root.children?.length ?? 0
        );
        span.setAttr('edit.outcome', 'read');
        return result;
      } catch (error) {
        span.setAttr('edit.outcome', signal.aborted ? 'aborted' : 'failed');
        span.error(error);
        throw error;
      }
    });
    return c.json({ state: result.state, revision: result.revision });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (c.req.raw.signal.aborted)
      return c.json({ error: 'aborted', message }, 499 as 502);
    if (signal.aborted) return c.json({ error: 'timeout', message }, 504);
    console.error('lexical state read failed:', message);
    return c.json({ error: 'sync_failed', message }, 502);
  }
});

export default lexicalState;
