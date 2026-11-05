import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import { match } from 'ts-pattern';
import * as z from 'zod';
import { tokenAccessLevel } from '../document-token';
import { type Bindings, getEnv } from '../env';
import { commitLexical, UnacknowledgedError } from '../lexical-commit/run';
import { createWorkerSyncSource } from '../sources';

const EDIT_ACCESS = new Set(['edit', 'owner']);

const LexicalCommitBody = z.object({
  documentId: z.string().min(1),
  documentToken: z.string().min(1),
  /** The revision the program read, from `/lexical-state` or a previous commit. */
  revision: z.string().min(1),
  // Node JSON, the block limit and placement are checked against the base,
  // answering 422.
  blocks: z.array(
    z.object({
      id: z.string().min(1),
      after: z.string().min(1).nullable(),
      node: z.unknown(),
    })
  ),
  removed: z.array(z.string().min(1)),
  /** Names the peer the commit is attributed to. */
  editor: z.object({ name: z.string().trim().min(1) }).optional(),
});

const lexicalCommit = new Hono<{ Bindings: Bindings }>();

/**
 * Commit a program's Lexical edit: the top-level blocks it changed against
 * the revision it read. The worker merges them with everything that changed
 * since, node by node, and applies all or nothing; a conflict answers 409.
 */
lexicalCommit.post('/', zValidator('json', LexicalCommitBody), async (c) => {
  const env = getEnv(c.env);
  const { documentId, documentToken, revision, blocks, removed, editor } =
    c.req.valid('json');
  // A forged edit claim still fails signature verification on initial sync.
  if (!EDIT_ACCESS.has(tokenAccessLevel(documentToken) ?? ''))
    return c.json(
      { error: 'forbidden', message: 'Committing requires edit access.' },
      403
    );
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(30_000),
  ]);
  try {
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
    const outcome = await Telemetry.span(
      'edit.lexical_commit',
      async (span) => {
        span.setAttr('document.id', documentId);
        span.setAttr('edit.blocks_total', blocks.length);
        span.setAttr('edit.removed_total', removed.length);
        span.setAttr('edit.editor_named', editor !== undefined);
        try {
          const outcome = await commitLexical(
            createWorkerSyncSource(wsUrl, documentId, signal),
            documentId,
            {
              revision,
              blocks: blocks.map(({ id, after, node }) => ({
                id,
                after: after ?? null,
                node,
              })),
              removed,
            },
            { editor, signal }
          );
          span.setAttr(
            'edit.outcome',
            match(outcome)
              .with({ kind: 'committed', applied: true }, () => 'applied')
              .with({ kind: 'committed', applied: false }, () => 'unchanged')
              .with({ kind: 'conflict' }, () => 'conflict')
              .with({ kind: 'invalid' }, () => 'invalid')
              .exhaustive()
          );
          span.setAttr(
            'edit.conflicts',
            outcome.kind === 'conflict' ? outcome.conflicts.length : 0
          );
          return outcome;
        } catch (error) {
          span.setAttr(
            'edit.outcome',
            error instanceof UnacknowledgedError
              ? 'unacknowledged'
              : signal.aborted
                ? 'aborted'
                : 'failed'
          );
          span.error(error);
          throw error;
        }
      }
    );
    return match(outcome)
      .with({ kind: 'committed' }, ({ revision, state }) =>
        c.json({ revision, state })
      )
      .with({ kind: 'conflict' }, ({ conflicts }) =>
        c.json({ error: 'conflict', conflicts }, 409)
      )
      .with({ kind: 'invalid' }, ({ message }) =>
        c.json({ error: 'invalid', message }, 422)
      )
      .exhaustive();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UnacknowledgedError)
      return c.json({ error: 'unacknowledged', message }, 502);
    if (c.req.raw.signal.aborted)
      return c.json({ error: 'aborted', message }, 499 as 502);
    if (signal.aborted) return c.json({ error: 'timeout', message }, 504);
    console.error('lexical commit failed:', message);
    return c.json({ error: 'sync_failed', message }, 502);
  }
});

export default lexicalCommit;
