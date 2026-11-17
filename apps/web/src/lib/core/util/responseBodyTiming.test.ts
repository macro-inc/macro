import type { Span } from '@macro-inc/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeResponseBody } from './responseBodyTiming';

type RecordedSpan = Span & { attrs: Record<string, unknown> };

function recordingSpan(): RecordedSpan {
  const attrs: Record<string, unknown> = {};
  return {
    attrs,
    setAttr: (name: string, value: unknown) => {
      attrs[name] = value;
    },
  } as RecordedSpan;
}

// A body that streams its chunks only when the test pushes them.
function pushedBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
    },
  });
  return {
    stream,
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    close: () => controller.close(),
    fail: (error: unknown) => controller.error(error),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('timeResponseBody', () => {
  it('times from the headers to the end of the first read, and leaves its result unchanged', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance'],
    });
    const body = pushedBody();
    const response = new Response(body.stream, {
      headers: { 'Content-Type': 'application/json' },
    });
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(response, span, {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled,
    });

    const read = response.json();
    body.push('{"items":');
    vi.advanceTimersByTime(1500);
    body.push('[1,2]}');
    body.close();

    expect(await read).toEqual({ items: [1, 2] });
    expect(span.attrs).toEqual({
      'http.body_ms': 1500,
      'http.body_outcome': 'complete',
    });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('counts a body read twice once, and does not count a clone', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'Content-Type': 'application/json' },
    });
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(response, span, {
      prefix: 'graphql',
      headersAt: performance.now(),
      onSettled,
    });

    expect(await response.clone().text()).toBe('{"ok":true}');
    expect(onSettled).not.toHaveBeenCalled();

    const first = response.text();
    await expect(response.json()).rejects.toThrow(TypeError);
    expect(await first).toBe('{"ok":true}');
    expect(span.attrs['graphql.body_outcome']).toBe('complete');
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('records a body that fails mid-read as an error', async () => {
    const body = pushedBody();
    const response = new Response(body.stream);
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(response, span, {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled,
    });

    const read = response.text();
    body.push('partial');
    body.fail(new TypeError('network connection was lost'));

    await expect(read).rejects.toThrow('network connection was lost');
    expect(span.attrs['http.body_outcome']).toBe('error');
    expect(span.attrs['http.body_ms']).toEqual(expect.any(Number));
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('records invalid JSON as an error', async () => {
    const response = new Response('<html>', {
      headers: { 'Content-Type': 'application/json' },
    });
    const span = recordingSpan();
    timeResponseBody(response, span, {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled: () => {},
    });

    await expect(response.json()).rejects.toThrow(SyntaxError);
    expect(span.attrs['http.body_outcome']).toBe('error');
  });

  it('records a read the request signal cancelled as aborted', async () => {
    const controller = new AbortController();
    const body = pushedBody();
    const response = new Response(body.stream);
    const span = recordingSpan();
    timeResponseBody(response, span, {
      prefix: 'http',
      headersAt: performance.now(),
      signal: controller.signal,
      onSettled: () => {},
    });

    const read = response.arrayBuffer();
    controller.abort();
    // The native transport rejects a cancelled body with a plain string.
    body.fail('Request cancelled');

    await expect(read).rejects.toBe('Request cancelled');
    expect(span.attrs['http.body_outcome']).toBe('aborted');
  });

  it('settles a body nobody read as unread when released, once', () => {
    const response = new Response('ignored');
    const span = recordingSpan();
    const onSettled = vi.fn();
    const timing = timeResponseBody(response, span, {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled,
    });

    timing.release();
    timing.release();

    expect(span.attrs).toEqual({ 'http.body_outcome': 'unread' });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('releases a body still being read after the wait as incomplete, and ignores its late end', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance'],
    });
    const body = pushedBody();
    const response = new Response(body.stream);
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(response, span, {
      prefix: 'graphql',
      headersAt: performance.now(),
      onSettled,
    });

    const read = response.text();
    body.push('slow');
    vi.advanceTimersByTime(60_000);
    expect(span.attrs).toEqual({ 'graphql.body_outcome': 'incomplete' });
    expect(onSettled).toHaveBeenCalledOnce();

    body.close();
    expect(await read).toBe('slow');
    expect(span.attrs).toEqual({ 'graphql.body_outcome': 'incomplete' });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('adds the timed reads without making them enumerable', () => {
    const response = new Response('{}');
    timeResponseBody(response, recordingSpan(), {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled: () => {},
    }).release();

    expect(Object.keys(response)).toEqual([]);
    expect(Object.hasOwn(response, 'json')).toBe(true);
  });

  it('cancels the wait once the body settles', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance'],
    });
    const response = new Response('{}');
    const timing = timeResponseBody(response, recordingSpan(), {
      prefix: 'graphql',
      headersAt: performance.now(),
      onSettled: () => {},
    });

    await response.text();
    expect(vi.getTimerCount()).toBe(0);
    timing.release();
  });

  it.each([
    'text/event-stream',
    'multipart/mixed; boundary="-"',
    'application/x-ndjson',
  ])('settles a %s response at once without timing it', async (contentType) => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance'],
    });
    const response = new Response('data: {}\n\n', {
      headers: { 'Content-Type': contentType },
    });
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(response, span, {
      prefix: 'graphql',
      headersAt: performance.now(),
      onSettled,
    });

    expect(span.attrs).toEqual({ 'graphql.body_outcome': 'stream' });
    expect(onSettled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.hasOwn(response, 'text')).toBe(false);
    expect(await response.text()).toBe('data: {}\n\n');
  });

  it('settles a response without a body at once', () => {
    const span = recordingSpan();
    const onSettled = vi.fn();
    timeResponseBody(new Response(null, { status: 204 }), span, {
      prefix: 'http',
      headersAt: performance.now(),
      onSettled,
    });

    expect(span.attrs).toEqual({ 'http.body_outcome': 'empty' });
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
