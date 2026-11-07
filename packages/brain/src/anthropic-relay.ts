// Only the brain knows the enrollment credential. Each SDK query gets a
// path-bound capability, revoked (and its upstream requests closed) on exit.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { startSpan } from './telemetry.ts';

export interface AnthropicLease {
  baseUrl: string;
  token: string;
  revoke(): void;
}
export type AnthropicAccess = (signal: AbortSignal) => AnthropicLease;

export async function anthropicRelay(baseUrl: string, key: string) {
  const upstream = new URL(baseUrl.replace(/\/+$/, '') + '/');
  if (
    !['http:', 'https:'].includes(upstream.protocol) ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash
  )
    throw new Error('Anthropic upstream must be an HTTP(S) service base');
  const leases = new Map<
    string,
    { token: string; stop: AbortController; revoke(): void }
  >();
  const server = createServer((incoming, outgoing) => {
    const path =
      /^\/([a-f0-9]{64})\/(v1\/messages(?:\/count_tokens)?)(\?beta=true)?$/.exec(
        incoming.url ?? ''
      );
    const lease = path && leases.get(path[1]!);
    const authorization = Buffer.from(incoming.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${lease ? lease.token : ''}`);
    if (
      !lease ||
      authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)
    ) {
      outgoing.writeHead(401).end();
      incoming.resume();
      return;
    }
    if (incoming.method !== 'POST') {
      outgoing.writeHead(405).end();
      incoming.resume();
      return;
    }
    const parent = propagation.extract(context.active(), incoming.headers);
    const span = context.with(parent, () =>
      startSpan('brain.anthropic.request', {
        'http.request.method': 'POST',
        'brain.anthropic.endpoint':
          path[2] === 'v1/messages' ? 'messages' : 'count_tokens',
      })
    );
    const headers: Record<string, string | string[]> = {
      authorization: `Bearer ${key}`,
    };
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (
        value !== undefined &&
        (name.startsWith('anthropic-') ||
          [
            'content-type',
            'content-length',
            'accept',
            'accept-encoding',
            'traceparent',
            'tracestate',
          ].includes(name))
      )
        headers[name] = value;
    }
    propagation.inject(trace.setSpan(parent, span), headers);
    const target = new URL(path[2]! + (path[3] ?? ''), upstream);
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: 'POST',
        headers,
      }
    );
    const cancel = () => {
      request.destroy();
      outgoing.destroy();
    };
    lease.stop.signal.addEventListener('abort', cancel, { once: true });
    outgoing.once('close', () => {
      request.destroy();
      lease.stop.signal.removeEventListener('abort', cancel);
      span.setAttribute('brain.aborted', !outgoing.writableFinished);
      span.end();
    });
    incoming.once('aborted', cancel);
    incoming.once('error', cancel);
    request.once('error', () => {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (!outgoing.headersSent)
        outgoing.writeHead(502).end('Anthropic upstream unavailable');
      else outgoing.destroy();
    });
    request.once('response', (response) => {
      span.setAttribute(
        'http.response.status_code',
        response.statusCode ?? 502
      );
      if (!response.statusCode || response.statusCode >= 300)
        span.setStatus({ code: SpanStatusCode.ERROR });
      const responseHeaders = { ...response.headers };
      for (const name of (response.headers.connection ?? '').split(','))
        delete responseHeaders[name.trim().toLowerCase()];
      for (const name of [
        'connection',
        'keep-alive',
        'transfer-encoding',
        'upgrade',
        'proxy-authenticate',
        'proxy-authorization',
        'trailer',
        'authorization',
        'x-api-key',
        'set-cookie',
        'location',
      ])
        delete responseHeaders[name];
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      outgoing.flushHeaders();
      response.once('error', cancel);
      // Native streams preserve bytes (including compressed SSE) and backpressure.
      response.pipe(outgoing);
    });
    incoming.pipe(request);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Anthropic relay failed to bind loopback');
  let closed = false;
  const access: AnthropicAccess = (signal) => {
    if (closed || signal.aborted)
      throw new Error('Anthropic query is not active');
    const id = randomBytes(32).toString('hex');
    const token = randomBytes(32).toString('hex');
    const stop = new AbortController();
    const revoke = () => {
      leases.delete(id);
      signal.removeEventListener('abort', revoke);
      stop.abort();
    };
    leases.set(id, { token, stop, revoke });
    signal.addEventListener('abort', revoke, { once: true });
    return { baseUrl: `http://127.0.0.1:${address.port}/${id}`, token, revoke };
  };
  return {
    access,
    async close() {
      if (closed) return;
      closed = true;
      for (const lease of leases.values()) lease.revoke();
      leases.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
