import { Hono } from 'hono';
import type { Bindings } from '../env';
import { createWorkerSpreadsheetCalculator } from '../spreadsheet/calculator';
import {
  createSpreadsheetStorage,
  runSpreadsheetRequest,
  SpreadsheetRequestError,
} from '../spreadsheet/runtime';
import { spreadsheetBodySchema } from '../spreadsheet/schema';

const MAX_REQUEST_BYTES = 1024 * 1024;
const app = new Hono<{ Bindings: Bindings }>();

app.post('/', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > MAX_REQUEST_BYTES)
    return c.json(
      { error: 'Spreadsheet requests may contain at most 1 MiB.' },
      413
    );
  let size = 0;
  const chunks: Uint8Array[] = [];
  const reader = c.req.raw.body?.getReader();
  if (!reader)
    return c.json({ error: 'A spreadsheet request body is required.' }, 400);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return c.json(
          { error: 'Spreadsheet requests may contain at most 1 MiB.' },
          413
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return c.json({ error: 'The request body must be valid JSON.' }, 400);
  }
  const parsed = spreadsheetBodySchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      },
      400
    );
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(30_000),
  ]);
  let calculator:
    | ReturnType<typeof createWorkerSpreadsheetCalculator>
    | undefined;
  try {
    const { documentId, documentToken, request } = parsed.data;
    const storage = createSpreadsheetStorage(
      c.env.SYNC_WS_BASE,
      documentId,
      documentToken
    );
    calculator = createWorkerSpreadsheetCalculator();
    return c.json(
      await runSpreadsheetRequest(request, storage, calculator, signal)
    );
  } catch (error) {
    if (error instanceof SpreadsheetRequestError)
      return c.json({ error: error.message }, error.status);
    if (signal.aborted)
      return c.json(
        {
          error:
            'The spreadsheet operation timed out or was cancelled. Read the workbook before retrying an edit.',
        },
        504
      );
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The spreadsheet operation failed.',
      },
      400
    );
  } finally {
    calculator?.dispose();
  }
});

export default app;
