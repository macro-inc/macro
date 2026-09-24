import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import * as z from 'zod';
import { runCommentMarkChange } from '../comment-mark/run';
import { type Bindings, getEnv } from '../env';
import { createWorkerSyncSource } from '../sources';

const CommentMarkBody = z.object({
  documentToken: z.string(),
  documentId: z.string(),
  change: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('add'),
      markId: z.uuid(),
      text: z.string().min(1).max(10_000),
      occurrence: z.number().int().min(1).nullish(),
    }),
    z.object({ action: z.literal('remove'), markId: z.uuid() }),
  ]),
});

const commentMark = new Hono<{ Bindings: Bindings }>();

/**
 * Place or remove the comment mark an inline comment is anchored to. A mark
 * that cannot be placed exactly answers 422 with the reason and leaves the
 * document untouched.
 */
commentMark.post('/', zValidator('json', CommentMarkBody), async (c) => {
  const env = getEnv(c.env);
  const { documentToken, documentId, change } = c.req.valid('json');
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(20_000),
  ]);
  try {
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
    const result = await Telemetry.span('comment_mark.change', async (span) => {
      span.setAttr('document.id', documentId);
      span.setAttr('comment_mark.action', change.action);
      const result = await runCommentMarkChange(
        createWorkerSyncSource(wsUrl, documentId, signal),
        documentId,
        change
      );
      if ('reason' in result)
        span.setAttr('comment_mark.refused', result.reason);
      return result;
    });
    if ('reason' in result)
      return c.json({ error: result.message, reason: result.reason }, 422);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('comment mark change failed:', message);
    return c.json({ error: message }, signal.aborted ? 504 : 502);
  }
});

export default commentMark;
