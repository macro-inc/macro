import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import { match } from 'ts-pattern';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import { runMarkdownRequest } from '../markdown/body';
import { EditRefusal } from '../markdown/direct-edit/edits';
import {
  DirectEditConflict,
  readMarkdownBlocks,
  runDirectEdit,
} from '../markdown/direct-edit/run';
import { createSyncDocumentStorage, SyncDocumentError } from '../sync-document';

/** Markdown longer than this is refused; the snapshot limit binds well before. */
const MAX_MARKDOWN_CHARS = 1_000_000;

/** One batch holds at most this many edits. */
const MAX_EDITS = 200;
const blockId = z.string().min(1).max(256);
/** A block id, or `start` / `end`. */
const position = blockId;
const text = z.string().max(MAX_MARKDOWN_CHARS);

const DirectEdit = z.union([
  z
    .object({
      block_id: blockId.optional(),
      old: text,
      new: text,
      replace_all: z.boolean().optional(),
    })
    .strict(),
  z.object({ insert_after: position, markdown: text }).strict(),
  z.object({ insert_before: position, markdown: text }).strict(),
  z.object({ delete: blockId }).strict(),
  z.object({ move: blockId, after: position }).strict(),
  z.object({ move: blockId, before: position }).strict(),
]);

const MarkdownBody = z
  .object({
    documentId: z.uuid(),
    documentToken: z.string().min(1).max(16_384),
    request: z.discriminatedUnion('action', [
      z.object({ action: z.literal('read') }).strict(),
      z
        .object({
          action: z.literal('write'),
          expectedRevision: z.string().min(1).max(100_000),
          markdown: z.string().max(MAX_MARKDOWN_CHARS),
        })
        .strict(),
      z.object({ action: z.literal('blocks') }).strict(),
      z
        .object({
          action: z.literal('edit'),
          edits: z.array(DirectEdit).min(1).max(MAX_EDITS),
          baseRevision: z.string().min(1).max(100_000).optional(),
          dryRun: z.boolean().optional(),
          allowDeletingContent: z.boolean().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

function failureMessage(error: SyncDocumentError): string {
  return match(error.failure)
    .with(
      'conflict',
      () =>
        'The document changed since it was read. Read it again and retry with the new revision.'
    )
    .with(
      'denied',
      () => 'You do not have the required access to this document.'
    )
    .with('not_found', () => 'The document could not be found.')
    .with('too_large', () =>
      error.operation === 'read'
        ? 'The document exceeds the 4 MiB snapshot limit.'
        : 'The change is too large to write at once. Write it in smaller parts.'
    )
    .with('rejected', () => 'The sync service rejected the update.')
    .with('unavailable', () => 'The sync service is unavailable. Please retry.')
    .with(
      'invalid_response',
      () =>
        'The sync service returned an invalid response. Read the document before retrying.'
    )
    .exhaustive();
}

const markdown = new Hono<{ Bindings: Bindings }>();

/**
 * Read a markdown document's body with its revision, or replace the body if
 * the document is still at the revision the caller read: 409 when it has
 * changed since, and nothing is written.
 */
markdown.post('/', zValidator('json', MarkdownBody), async (c) => {
  const env = getEnv(c.env);
  const { documentId, documentToken, request } = c.req.valid('json');
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(30_000),
  ]);
  try {
    const storage = createSyncDocumentStorage(
      env.SYNC_WS_BASE,
      documentId,
      documentToken
    );
    if (request.action === 'blocks') {
      const blocks = await Telemetry.span('markdown.blocks', async (span) => {
        span.setAttr('document.id', documentId);
        const read = await readMarkdownBlocks(documentId, storage, signal);
        span.setAttr('markdown.blocks', read.blocks.length);
        return read;
      });
      return c.json({ action: 'blocks', ...blocks });
    }
    if (request.action === 'edit') {
      const { action, ...edit } = request;
      const result = await Telemetry.span('edit.direct', async (span) => {
        span.setAttr('document.id', documentId);
        try {
          const result = await runDirectEdit(
            documentId,
            edit,
            storage,
            signal,
            span
          );
          span.setAttr('edit.outcome', result.outcome);
          span.setAttr('edit.changes', result.changes.length);
          return result;
        } catch (error) {
          if (error instanceof EditRefusal) {
            span.setAttr('edit.outcome', 'refused');
            span.setAttr('edit.refusal', error.code);
          } else if (error instanceof DirectEditConflict)
            span.setAttr('edit.outcome', 'conflict');
          throw error;
        }
      });
      return c.json({ action, ...result });
    }
    const response = await Telemetry.span('markdown.body', async (span) => {
      span.setAttr('document.id', documentId);
      span.setAttr('markdown.action', request.action);
      const response = await runMarkdownRequest(
        documentId,
        request,
        storage,
        signal
      );
      if (response.action === 'write')
        span.setAttr('markdown.changed', response.changed);
      return response;
    });
    return c.json(response);
  } catch (error) {
    if (error instanceof EditRefusal)
      return c.json(
        {
          error: error.message,
          refusal: {
            code: error.code,
            message: error.message,
            edit: error.edit ?? null,
            candidates: error.candidates ?? [],
          },
        },
        422
      );
    if (error instanceof DirectEditConflict)
      return c.json(
        { error: error.message, conflict: { edit: error.edit ?? null } },
        409
      );
    if (error instanceof SyncDocumentError)
      return c.json({ error: failureMessage(error) }, error.status);
    if (signal.aborted)
      return c.json(
        {
          error:
            'The document operation timed out or was cancelled. Read the document before retrying a write.',
        },
        504
      );
    const message = error instanceof Error ? error.message : String(error);
    console.error('markdown body request failed:', message);
    return c.json({ error: message }, 502);
  }
});

export default markdown;
