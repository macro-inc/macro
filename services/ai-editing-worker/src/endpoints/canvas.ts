import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { editCanvas } from '../canvas/agent';
import { applyCanvasCode } from '../canvas/direct';
import { canvasRenderOptions, createCanvasRenderer } from '../canvas/render';
import { canvasRevision } from '../canvas/revision';
import { withCanvasSession } from '../canvas/session';
import { tokenAccessLevel } from '../document-token';
import { type Bindings, getEnv } from '../env';
import { createWorkerSyncSource } from '../sources';
import { buildModels } from './edit';

const body = z
  .object({
    documentId: z.string().uuid(),
    documentToken: z.string().min(1).max(10000),
    request: z.discriminatedUnion('action', [
      z
        .object({
          action: z.literal('read'),
          itemIds: z.array(z.string().max(200)).max(100).optional(),
          format: z.enum(['scene', 'overview']).optional(),
        })
        .strict(),
      canvasRenderOptions.extend({ action: z.literal('render') }).strict(),
      z
        .object({
          action: z.literal('apply'),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
          code: z.string().min(1).max(50_000),
          snippets: z
            .record(z.string().max(200), z.string().max(20000))
            .refine(
              (values) =>
                Object.keys(values).length <= 100 &&
                Object.entries(values).every(
                  ([key, value]) =>
                    new TextEncoder().encode(key).length <= 200 &&
                    new TextEncoder().encode(value).length <= 20000
                ) &&
                Object.values(values).reduce(
                  (sum, value) => sum + new TextEncoder().encode(value).length,
                  0
                ) <= 50000,
              'Canvas snippets exceed the bounded text budget.'
            )
            .optional(),
          editorName: z.string().trim().min(1).max(200).optional(),
        })
        .strict(),
      z
        .object({
          action: z.literal('edit'),
          instructions: z.string().min(1).max(20000),
          editorName: z.string().trim().min(1).max(200).optional(),
        })
        .strict(),
    ]),
  })
  .strict();
const app = new Hono<{ Bindings: Bindings }>();
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }));
app.post('/', zValidator('json', body), async (c) => {
  const { documentId, documentToken, request } = c.req.valid('json');
  // Comment tokens can connect and send some updates. Do not let them edit a scene.
  // A forged edit claim still fails signature verification on initial sync, before the model starts.
  if (
    ['edit', 'apply'].includes(request.action) &&
    !['edit', 'owner'].includes(tokenAccessLevel(documentToken) ?? '')
  )
    return c.json({ error: 'Editing a canvas requires edit access.' }, 403);
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(120_000),
  ]);
  try {
    return c.json(
      await Telemetry.span('canvas.ai.session', async (span) => {
        span.setAttr('document.id', documentId);
        span.setAttr('edit.action', request.action);
        // The sync service verifies the scoped token and enforces edit permission on writes.
        const url = new URL(
          `${c.env.SYNC_WS_BASE}/document/${documentId}/connect`
        );
        url.searchParams.set('token', documentToken);
        const trace = span.traceparent();
        const readiness = new URL(url);
        if (readiness.protocol === 'wss:') readiness.protocol = 'https:';
        else if (readiness.protocol === 'ws:') readiness.protocol = 'http:';
        readiness.pathname = `/document/${documentId}/exists`;
        readiness.search = '';
        const status = await fetch(readiness, {
          method: 'HEAD',
          headers: {
            Authorization: `Bearer ${documentToken}`,
            ...(trace ? { traceparent: trace } : {}),
          },
          signal,
        });
        if (status.status === 404)
          throw new Error(
            'Canvas shared snapshot is missing. Native Canvas creation must finish before editing. For an existing imported Canvas, open it once to migrate its stored scene; no edits were attempted.'
          );
        if (!status.ok)
          throw new Error(
            `Canvas shared storage check failed (HTTP ${status.status}); no edits were attempted.`
          );
        if (trace) url.searchParams.set('traceparent', trace);
        if (request.action === 'read')
          return withCanvasSession(
            createWorkerSyncSource(url.toString(), documentId, signal),
            signal,
            async (session) => ({
              canvas: JSON.stringify({
                ...JSON.parse(session.read(request.itemIds, request.format)),
                revision: await canvasRevision(session.snapshot()),
              }),
              operationsApplied: 0,
              summary: 'Read the current canvas.',
              usage: [],
            })
          );
        const renderer = createCanvasRenderer(c.env);
        if (request.action === 'render')
          return withCanvasSession(
            createWorkerSyncSource(url.toString(), documentId, signal),
            signal,
            async (session) => ({
              render: await renderer(
                session.snapshot(),
                { itemIds: request.itemIds, crop: request.crop },
                signal
              ),
              operationsApplied: 0,
              summary: 'Rendered an immutable Canvas snapshot.',
              usage: [],
            })
          );
        if (request.action === 'apply')
          return withCanvasSession(
            createWorkerSyncSource(url.toString(), documentId, signal),
            signal,
            (session) =>
              applyCanvasCode(session, request, renderer.measure, signal),
            request.editorName
          );
        const model = buildModels(
          getEnv(c.env),
          {
            fast: [
              { provider: 'anthropic', model: 'claude-sonnet-5-5' },
              { provider: 'anthropic', model: 'claude-haiku-4-5' },
            ],
          },
          'fast'
        ).fast;
        const result = await editCanvas(
          createWorkerSyncSource(url.toString(), documentId, signal),
          request.instructions,
          model,
          signal,
          request.editorName,
          {
            render: renderer,
            measure: renderer.measure,
            createSource: () =>
              createWorkerSyncSource(url.toString(), documentId, signal),
          }
        );
        span.setAttr('edit.ops_total', result.operationsApplied);
        span.setAttr(
          'edit.outcome',
          'error' in result ? 'stopped' : 'completed'
        );
        if ('error' in result) span.error(new Error('Canvas editing stopped.'));
        return result;
      })
    );
  } catch (error) {
    return c.json(
      {
        error: signal.aborted
          ? 'Canvas edit cancelled or timed out. Read the canvas before retrying; earlier edits may have applied.'
          : error instanceof Error
            ? error.message
            : 'Canvas operation failed.',
      },
      502
    );
  }
});
export default app;
