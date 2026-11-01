import type { Span } from '@macro-inc/observability';
import { expect, it, vi } from 'vitest';
import { createSessionWebsocketTelemetry } from './session-websocket-telemetry';

class RecordedSpan implements Span {
  static active: RecordedSpan | undefined;
  children: RecordedSpan[] = [];
  attributes: Record<string, unknown> = {};
  errors: unknown[] = [];
  ends = 0;
  constructor(readonly name: string) {}
  span(name: string): Span;
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span<T>(
    name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    const child = new RecordedSpan(name);
    this.children.push(child);
    if (!operation) return child;
    return child.run(async () => {
      try {
        return await operation(child);
      } finally {
        child.end();
      }
    });
  }
  run<T>(operation: () => T): T {
    const previous = RecordedSpan.active;
    RecordedSpan.active = this;
    try {
      return operation();
    } finally {
      RecordedSpan.active = previous;
    }
  }
  setAttr(name: string, value: unknown) {
    this.attributes[name] = value;
  }
  event() {}
  error(error: unknown) {
    this.errors.push(error);
  }
  traceparent() {
    return undefined;
  }
  injectTraceHeaders() {}
  end() {
    this.ends++;
  }
}

it('links timed URL and handshake phases, retries, and closure without recording credentials', async () => {
  const resolve = vi.fn(() => {
    expect(RecordedSpan.active?.name).toBe('auth.session_socket.resolve_url');
    return 'wss://example.test/socket?macro-api-token=secret';
  });
  const telemetry = createSessionWebsocketTelemetry(
    'connection-gateway',
    resolve
  );
  const root = new RecordedSpan('activation');
  const stop = telemetry.activate(root);
  expect(await telemetry.resolveUrl()).toContain('macro-api-token=secret');
  const attempt = root.children[1];
  expect(attempt.name).toBe('auth.session_socket.connect');
  expect(attempt.children.map((phase) => [phase.name, phase.ends])).toEqual([
    ['auth.session_socket.resolve_url', 1],
    ['auth.session_socket.handshake', 0],
  ]);
  telemetry.opened();
  expect(attempt.ends).toBe(1);
  expect(attempt.attributes.outcome).toBe('connected');
  expect(attempt.children[1].ends).toBe(1);

  telemetry.closed({ code: 1006, wasClean: false });
  telemetry.retry({ retries: 1, backoff: 500 });
  expect(root.children[2].attributes).toMatchObject({
    'ws.close_code': 1006,
    outcome: 'disconnected',
  });
  expect(root.children[3].attributes).toMatchObject({
    'ws.retries': 1,
    'ws.backoff_ms': 500,
  });
  await telemetry.resolveUrl();
  const retryAttempt = root.children[4];
  telemetry.failed();
  expect(retryAttempt.attributes).toMatchObject({
    'ws.retries': 1,
    outcome: 'connection-failed',
  });
  expect(retryAttempt.errors).toEqual(['Session WebSocket connection-failed']);
  expect(retryAttempt.children.every((span) => span.ends === 1)).toBe(true);
  stop();
  expect(root.children.every((span) => span.ends === 1)).toBe(true);
  expect(JSON.stringify(root)).not.toContain('secret');
  const count = root.children.length;
  telemetry.closed({ code: 1000, wasClean: true });
  telemetry.retry({ retries: 2, backoff: 500 });
  telemetry.failed();
  stop();
  expect(root.children).toHaveLength(count);
});

it.each(['resolve', 'reject'] as const)(
  'finishes cancelled spans and isolates a late %s from the next session',
  async (settle) => {
    const oldUrl = Promise.withResolvers<string>();
    const resolve = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(oldUrl.promise)
      .mockResolvedValue('wss://example.test/new');
    const telemetry = createSessionWebsocketTelemetry('storage', resolve);
    const first = new RecordedSpan('first-session');
    const stopFirst = telemetry.activate(first);
    const pending = telemetry.resolveUrl();
    stopFirst();
    expect(first.children[1].attributes.outcome).toBe('cancelled');
    expect(first.children[1].children[0].ends).toBe(1);

    const second = new RecordedSpan('second-session');
    const stopSecond = telemetry.activate(second);
    await telemetry.resolveUrl();
    if (settle === 'resolve') {
      oldUrl.resolve('wss://example.test/old');
      await pending;
    } else {
      oldUrl.reject(new Error('sensitive token'));
      await expect(pending).rejects.toThrow('sensitive token');
    }
    expect(second.children[1].ends).toBe(0);
    telemetry.opened();
    expect(second.children[1].attributes.outcome).toBe('connected');
    stopSecond();
    expect(first.children.every((span) => span.ends === 1)).toBe(true);
    expect(second.children.every((span) => span.ends === 1)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('sensitive token');
  }
);

it('ends failed URL resolution spans without logging the raw error', async () => {
  const telemetry = createSessionWebsocketTelemetry('storage', () => {
    throw new Error('credential-bearing error');
  });
  const root = new RecordedSpan('activation');
  const stop = telemetry.activate(root);
  await expect(telemetry.resolveUrl()).rejects.toThrow(
    'credential-bearing error'
  );
  expect(root.children[1].attributes.outcome).toBe('url-resolution-failed');
  expect(root.children[1].ends).toBe(1);
  expect(root.children[1].children[0].ends).toBe(1);
  expect(JSON.stringify(root)).not.toContain('credential-bearing error');
  stop();
});
