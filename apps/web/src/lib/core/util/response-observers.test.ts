import { describe, expect, it, vi } from 'vitest';
import {
  guardResponseBody,
  prepareResponseObservers,
  registerResponseObserver,
} from './response-observers';

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
});
