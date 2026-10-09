import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { generationRequestSchema, runGeneration } from '../code-mode/ai';
import { runDocumentRequest } from '../code-mode/documents';
import { documentRequestSchema } from '../code-mode/operations';
import {
  createDocumentStorage,
  DocumentRequestError,
} from '../document-storage';
import type { Bindings } from '../env';

const codeMode = new Hono<{ Bindings: Bindings }>();
codeMode.use('*', bodyLimit({ maxSize: 256 * 1024 }));

codeMode.onError((error, c) => {
  if (error instanceof DocumentRequestError)
    return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: 'Invalid code SDK request.' }, 400);
  if (
    c.req.raw.signal.aborted ||
    error.name === 'TimeoutError' ||
    error.name === 'AbortError'
  )
    return c.json(
      {
        error:
          'Code SDK request cancelled. Read document state before retrying writes.',
      },
      504
    );
  // Provider errors can contain request bodies and credentials. Never echo them.
  return c.json(
    {
      error:
        'Code SDK operation failed. Check the inputs; read document state before retrying writes.',
    },
    502
  );
});

codeMode.post('/document', async (c) => {
  const body = z
    .strictObject({
      documentId: z.string().uuid(),
      documentToken: z.string().min(1).max(16_384),
      request: documentRequestSchema,
    })
    .parse(await c.req.json());
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(25_000),
  ]);
  const storage = createDocumentStorage(
    c.env.SYNC_WS_BASE,
    body.documentId,
    body.documentToken
  );
  return c.json(
    await runDocumentRequest(body.documentId, body.request, storage, signal)
  );
});

codeMode.post('/generate', async (c) => {
  // Only the backend, which admits and meters the session owner, can generate.
  if (!c.env.INTERNAL_API_KEY)
    return c.json({ error: 'AI generation is not configured.' }, 503);
  if (c.req.header('x-internal-auth-key') !== c.env.INTERNAL_API_KEY)
    return c.json({ error: 'Unauthorized.' }, 401);
  const request = generationRequestSchema.parse(await c.req.json());
  if (
    !(request.model === 'good'
      ? c.env.ANTHROPIC_API_KEY
      : c.env.GOOGLE_GENERATIVE_AI_API_KEY)
  )
    return c.json({ error: 'The selected AI model is not configured.' }, 503);
  const model =
    request.model === 'good'
      ? createAnthropic({ apiKey: c.env.ANTHROPIC_API_KEY })(
          'claude-sonnet-4-6'
        )
      : createGoogleGenerativeAI({
          apiKey: c.env.GOOGLE_GENERATIVE_AI_API_KEY,
        })('gemini-3.8-flash');
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(25_000),
  ]);
  return c.json(await runGeneration(request, model, signal));
});

export default codeMode;
