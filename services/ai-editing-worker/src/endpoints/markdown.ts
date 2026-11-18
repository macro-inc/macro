import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import { match } from 'ts-pattern';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import { runMarkdownRequest } from '../markdown/body';
import { createSyncDocumentStorage, SyncDocumentError } from '../sync-document';

/** Markdown longer than this is refused; the snapshot limit binds well before. */
const MAX_MARKDOWN_CHARS = 1_000_000;

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
    .with('too_large', () => 'The document exceeds the 4 MiB snapshot limit.')
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
