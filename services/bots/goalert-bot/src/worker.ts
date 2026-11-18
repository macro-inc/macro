import {
  createWorkerTraceConfig,
  instrument,
} from '@macro-inc/observability/worker';
import { createAlertChannel } from './channel';
import { createApp } from './index';
import { createKvAlertStore, type KeyValueNamespace } from './store';

/**
 * Cloudflare Worker entrypoint. Config comes from worker bindings
 * (vars + secrets + the KV namespace); see wrangler.jsonc. For local
 * development outside wrangler, src/server.ts provides the same app under Bun.
 */
type Env = {
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  ACTING_USER_ID: string;
  WEBHOOK_SECRET: string;
  ALERT_MESSAGES: KeyValueNamespace;
  /** Tags exported spans with deployment.environment (matches DD_ENV). */
  ENVIRONMENT: string | undefined;
  /** OTLP/HTTP traces endpoint; unset disables trace export. */
  OTEL_EXPORTER_OTLP_ENDPOINT: string | undefined;
  /** Datadog API key attached to trace exports when the endpoint is a
   * Datadog intake; secret, set via `wrangler secret put DD_API_KEY`. */
  DD_API_KEY: string | undefined;
};

const REQUIRED = [
  'BOT_TOKEN',
  'CHANNEL_ID',
  'ACTING_USER_ID',
  'WEBHOOK_SECRET',
  'ALERT_MESSAGES',
] as const satisfies readonly (keyof Env)[];

// One app per isolate, so the SDK's cached bot lookup survives across requests.
let app: ReturnType<typeof createApp> | undefined;

function fetch(request: Request, env: Env): Response | Promise<Response> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    return Response.json(
      { error: `missing worker bindings: ${missing.join(', ')}` },
      { status: 500 }
    );
  }

  app ??= createApp({
    webhookSecret: env.WEBHOOK_SECRET,
    channel: createAlertChannel({
      channelId: env.CHANNEL_ID,
      botToken: env.BOT_TOKEN,
      actingUserId: env.ACTING_USER_ID,
      env: 'prod',
    }),
    store: createKvAlertStore(env.ALERT_MESSAGES),
  });

  return app.fetch(request, env);
}

// instrument() wraps fetch with a request root span, registers the global
// tracer provider/context manager (which Telemetry.span resolves through),
// propagates traceparent, and flushes spans via waitUntil after the response.
export default instrument({ fetch }, (env: Env) =>
  createWorkerTraceConfig({
    serviceName: 'goalert-bot',
    environment: env.ENVIRONMENT ?? 'local',
    tracesUrl: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    tracesHeaders: env.DD_API_KEY
      ? { 'dd-api-key': env.DD_API_KEY }
      : undefined,
  })
);
