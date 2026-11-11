import {
  createWorkerTraceConfig,
  instrument,
} from '@macro-inc/observability/worker';
import { createHandler } from './app';
import { type Bindings, parseConfig } from './config';

// One handler per isolate: the tool list and validators are built once.
let handler: ReturnType<typeof createHandler> | undefined;

function fetch(request: Request, env: Bindings): Promise<Response> {
  handler ??= createHandler(parseConfig(env));
  return handler(request);
}

// instrument() opens a root span per request, propagates traceparent and
// flushes spans after the response.
export default instrument({ fetch }, (env: Bindings) =>
  createWorkerTraceConfig({
    serviceName: 'mcp-chatgpt-worker',
    environment: env.ENVIRONMENT ?? 'local',
    tracesUrl: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    tracesHeaders: env.DD_API_KEY
      ? { 'dd-api-key': env.DD_API_KEY }
      : undefined,
  })
);
