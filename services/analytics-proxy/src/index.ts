/// <reference path="../worker-configuration.d.ts" />

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// The OTLP traces intake needs a server-side Datadog API key the browser must
// never hold, so it lives as a Worker secret (set via
// `wrangler secret put DD_API_KEY`) and is injected here. The generated Env
// only knows vars/bindings declared in wrangler.jsonc, so augment it with the
// secret. It is absent locally (the dev OTLP collector trusts the container
// network), so the injection is conditional. Other providers rely on the
// client-side token already present on the request, so they need no
// augmentation.
declare global {
  interface Env {
    /** Datadog API key for the OTLP traces intake. Unset in local dev. */
    DD_API_KEY?: string;
  }
}

const POSTHOG_PREFIX = '/i/ph';
const POSTHOG_ORIGIN = 'https://us.i.posthog.com';
// Privacy filter lists block the upstream filename; keep the browser-facing
// alias opaque and restore the real filename only for the upstream request.
const POSTHOG_RECORDER_SCRIPT_NAME = 'posthog-recorder.js';
const POSTHOG_RECORDER_PROXY_SCRIPT_NAME = 'runtime.js';

// OTLP telemetry is proxied to a per-signal intake origin (full origin,
// scheme included, so it can be Datadog's https intakes in deployed envs or
// the plaintext otel-collector in the local pool — where one collector
// serves both signals). Split per signal because Datadog has no single OTLP
// origin: traces and logs use different intake hosts. Unlike the static
// providers the browser can't authenticate, so the Worker injects dd-api-key
// when present.
const OTLP_PREFIX = '/i/otlp';

/** Intake origin for an OTLP subpath, or null for an unknown signal. */
function otlpIntakeUrl(env: Env, path: string): string | null {
  if (path.startsWith('/v1/traces')) return env.OTLP_TRACES_INTAKE_URL;
  if (path.startsWith('/v1/logs')) return env.OTLP_LOGS_INTAKE_URL;
  return null;
}

async function handleProxy(
  request: Request,
  origin: string,
  pathWithSearch: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const originHeaders = new Headers(request.headers);
  originHeaders.delete('cookie');
  originHeaders.set(
    'X-Forwarded-For',
    request.headers.get('CF-Connecting-IP') || ''
  );
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    originHeaders.set(key, value);
  }

  const originRequest = new Request(`${origin}${pathWithSearch}`, {
    method: request.method,
    headers: originHeaders,
    body:
      request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.arrayBuffer()
        : null,
    redirect: request.redirect,
  });

  return await fetch(originRequest);
}

const app = new Hono<{ Bindings: Env }>();

// OTLP uses protobuf cross-origin. Cookies are stripped by handleProxy, so
// wildcard origins and headers are safe and preflights need no credentials.
app.use(
  `${OTLP_PREFIX}/*`,
  cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    maxAge: 86400,
  })
);

// DD is expensive and I don't want someone hammering it. not a perfect solution
// but better than nothing.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);

  // Cloudflare's edge sets CF-Connecting-IP on every real request; the local
  // pool's Caddy route forwards it too.
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientIp =
    c.req.header('CF-Connecting-IP') ||
    (isLocalhost ? 'local-development' : null);
  if (!clientIp) return c.text('Missing CF-Connecting-IP', 400);

  const { success } = await c.env.RATE_LIMITER.limit({ key: clientIp });
  if (!success) return c.text('Too Many Requests', 429);

  await next();
});

app.all(`${OTLP_PREFIX}/*`, async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.slice(OTLP_PREFIX.length) || '/';
  const intake = otlpIntakeUrl(c.env, path);
  if (!intake) return c.text('Not found', 404);

  return handleProxy(
    c.req.raw,
    intake,
    path + url.search,
    c.env.DD_API_KEY ? { 'dd-api-key': c.env.DD_API_KEY } : undefined
  );
});

app.all(`${POSTHOG_PREFIX}/*`, (c) => {
  const url = new URL(c.req.url);
  const proxyPath = url.pathname.slice(POSTHOG_PREFIX.length) || '/';
  const path =
    proxyPath === `/static/${POSTHOG_RECORDER_PROXY_SCRIPT_NAME}`
      ? `/static/${POSTHOG_RECORDER_SCRIPT_NAME}`
      : proxyPath;
  return handleProxy(c.req.raw, POSTHOG_ORIGIN, path + url.search);
});

app.notFound((c) => c.text('Not found', 404));

export default app;
