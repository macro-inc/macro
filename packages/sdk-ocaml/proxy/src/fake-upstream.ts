/**
 * A fake Macro service for tests and the end-to-end script: records every
 * request exactly as it arrived (raw target, headers, body) and answers from
 * canned responses keyed by `"<METHOD> <raw target>"`, query included.
 *
 *   bun run src/fake-upstream.ts --responses <responses.json> --port 8789
 *
 * An unlisted request gets `404 {"error":"no canned response"}`. Each request
 * is also logged as one JSON line (method and target only).
 */
import { createServer, type Server } from 'node:http';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { readJsonFile, required } from './http';

export type RecordedRequest = {
  method: string;
  target: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export const CannedResponse = z.object({
  status: z.number().int().min(200).max(599),
  contentType: z.string().optional(),
  body: z.string(),
});

export type CannedResponse = z.infer<typeof CannedResponse>;

export const ResponsesFile = z.record(z.string(), CannedResponse);

export type FakeUpstream = {
  url: string;
  requests: RecordedRequest[];
  server: Server;
  stop: () => Promise<void>;
};

const NOT_FOUND: CannedResponse = {
  status: 404,
  contentType: 'application/json',
  body: '{"error":"no canned response"}',
};

export async function startFakeUpstream(
  respond: (request: RecordedRequest) => CannedResponse,
  options: {
    port?: number;
    onRequest?: (request: RecordedRequest) => void;
  } = {}
): Promise<FakeUpstream> {
  const requests: RecordedRequest[] = [];

  const server = createServer(async (message, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of message) chunks.push(Buffer.from(chunk));

    const request: RecordedRequest = {
      method: message.method ?? '',
      target: message.url ?? '',
      headers: message.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    requests.push(request);
    options.onRequest?.(request);

    const response = respond(request);
    reply.statusCode = response.status;
    if (response.contentType)
      reply.setHeader('content-type', response.contentType);
    reply.end(response.body);
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    server,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Answer from a responses file, by the file's own keys only. */
export function cannedResponses(
  responses: Readonly<Record<string, CannedResponse>>
) {
  return (request: RecordedRequest): CannedResponse => {
    const key = `${request.method} ${request.target}`;
    return (
      (Object.hasOwn(responses, key) ? responses[key] : undefined) ?? NOT_FOUND
    );
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      responses: { type: 'string' },
      port: { type: 'string', default: '8789' },
    },
  });
  const responses = await readJsonFile(
    required(values.responses, 'responses'),
    ResponsesFile
  );
  const upstream = await startFakeUpstream(cannedResponses(responses), {
    port: Number(values.port),
    onRequest: (request) =>
      console.log(
        JSON.stringify({
          event: 'upstream.request',
          method: request.method,
          target: request.target,
        })
      ),
  });
  console.log(
    JSON.stringify({ event: 'upstream.listening', url: upstream.url })
  );
}
