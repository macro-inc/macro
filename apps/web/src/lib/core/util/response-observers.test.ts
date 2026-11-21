import { describe, expect, it, vi } from 'vitest';
import {
  guardResponseBody,
  guardResponseDecoders,
  prepareResponseObservers,
  registerResponseObserver,
} from './response-observers';

/**
 * A response shaped like `@tauri-apps/plugin-http`'s: `url`, `headers` and a
 * per-instance `clone` are own, non-configurable properties.
 */
function nativeResponse(body: string) {
  const url = 'http://127.0.0.1:1/health';
  const headers = () => new Headers({ 'set-cookie': 'session=1' });
  const response = new Response(body, { status: 200 });
  Object.defineProperty(response, 'url', { value: url, writable: false });
  Object.defineProperty(response, 'headers', { value: headers() });
  Object.defineProperty(response, 'clone', {
    value: function (this: Response) {
      const cloned = Response.prototype.clone.call(this);
      Object.defineProperty(cloned, 'url', { value: url, writable: false });
      Object.defineProperty(cloned, 'headers', { value: headers() });
      return cloned;
    },
  });
  return response;
}

describe('response permission guards', () => {
  it('captures a generation synchronously before the caller dispatches', () => {
    let captured = false;
    const stop = registerResponseObserver(() => {
      captured = true;
      return (response) => response;
    });
    const guard = prepareResponseObservers('https://example.com');
    expect(captured).toBe(true);
    expect(guard).not.toBeInstanceOf(Promise);
    stop();
  });

  it('preserves successful decoders and clone metadata without consuming an inspected body', async () => {
    const original = new Response('{"name":"record"}', {
      status: 206,
      headers: { 'content-type': 'application/json', 'x-record': 'ready' },
    });
    const response = guardResponseBody(original, () => {});
    expect(response).toBe(original);
    expect(response.body).not.toBeNull();
    expect(response.bodyUsed).toBe(false);
    const clone = response.clone();
    expect(response.status).toBe(206);
    expect(clone.status).toBe(206);
    expect(clone.headers.get('x-record')).toBe('ready');
    await expect(response.text()).resolves.toBe('{"name":"record"}');
    await expect(clone.json()).resolves.toEqual({ name: 'record' });
    expect(response.bodyUsed).toBe(true);
    expect(clone.bodyUsed).toBe(true);
  });

  it('checks a decoded body without replacing the native stream, including clones', async () => {
    let current = true;
    const guard = () => {
      if (!current) throw new Error('revoked');
    };
    const original = new Response('{"name":"record"}');
    const body = original.body;
    const response = guardResponseDecoders(original, guard);
    expect(response.body).toBe(body);
    const clone = response.clone();
    await expect(response.json()).resolves.toEqual({ name: 'record' });
    current = false;
    await expect(clone.text()).rejects.toThrow('revoked');
  });

  it('preserves every observer guard when decorating a response and its clones', async () => {
    const response = guardResponseBody(
      guardResponseBody(new Response('retired'), () => {
        throw new Error('inner session retired');
      }),
      () => {}
    );
    const clone = response.clone();
    await expect(response.text()).rejects.toThrow('inner session retired');
    await expect(clone.text()).rejects.toThrow('inner session retired');
  });

  it('rejects a response whose body finishes after revocation, including clones', async () => {
    let current = true;
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const guard = () => {
      if (!current) throw new Error('revoked');
    };
    const response = guardResponseBody(
      new Response(
        new ReadableStream({
          start(controller) {
            body = controller;
          },
        })
      ),
      guard
    );
    const clone = response.clone();
    const text = response.text();
    const json = clone.json();
    current = false;
    body.enqueue(new TextEncoder().encode('{"name":"record"}'));
    body.close();
    await expect(text).rejects.toThrow('revoked');
    await expect(json).rejects.toThrow('revoked');
  });

  it('rejects pending stream reads before delivering revoked chunks, including clones', async () => {
    let current = true;
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = guardResponseBody(
      new Response(
        new ReadableStream({
          start: (value) => {
            body = value;
          },
          cancel,
        })
      ),
      () => {
        if (!current) throw new Error('revoked');
      }
    );
    const clone = response.clone();
    const first = response.body!.getReader().read();
    const second = clone.body!.getReader().read();
    current = false;
    body.enqueue(new Uint8Array([1]));
    await expect(first).rejects.toThrow('revoked');
    await expect(second).rejects.toThrow('revoked');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.skipIf(typeof Response.prototype.bytes !== 'function')(
    'rejects bytes decoded after revocation',
    async () => {
      let current = true;
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const response = guardResponseBody(
        new Response(
          new ReadableStream({
            start: (value) => {
              body = value;
            },
          })
        ),
        () => {
          if (!current) throw new Error('revoked');
        }
      );
      const bytes = response.bytes();
      current = false;
      body.enqueue(new Uint8Array([1]));
      body.close();
      await expect(bytes).rejects.toThrow('revoked');
    }
  );

  it.each([
    ['decoders', guardResponseDecoders],
    ['body', guardResponseBody],
  ])(
    'guards the %s of a native HTTP response, whose own properties cannot be redefined',
    async (_, guardResponse) => {
      let current = true;
      const stop = registerResponseObserver(
        () => (response) =>
          guardResponse(response, () => {
            if (!current) throw new Error('revoked');
          })
      );
      const response = prepareResponseObservers('http://127.0.0.1:1/health')(
        nativeResponse('{"ok":true}')
      );
      stop();
      expect(response.ok).toBe(true);
      expect(response.url).toBe('http://127.0.0.1:1/health');
      expect(response.headers.get('set-cookie')).toBe('session=1');
      const clone = response.clone();
      expect(clone.url).toBe('http://127.0.0.1:1/health');
      expect(clone.headers.get('set-cookie')).toBe('session=1');
      await expect(response.json()).resolves.toEqual({ ok: true });
      current = false;
      await expect(clone.text()).rejects.toThrow('revoked');
    }
  );
});
