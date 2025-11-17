import { describe, expect, test, vi } from 'vitest';
import type {
  WebsocketBuffer,
  WebsocketEvent,
  WebsocketEventListenerWithOptions,
} from '../';
import { ArrayQueue, ConstantBackoff, Websocket, WebsocketBuilder } from '../';

describe('Testsuite for WebSocketBuilder', () => {
  const url = 'ws://localhost:8080';

  test('WebsocketBuilder should set url', () => {
    const builder = new WebsocketBuilder(url);
    expect(builder.url).toBe(url);

    const ws = builder.build();
    expect(ws.url).toBe(url);
  });

  test('WebsocketBuilder should set protocols', () => {
    const protocols = ['protocol1', 'protocol2'];

    const builder = new WebsocketBuilder(url).withProtocols(protocols);
    expect(builder.protocols).toBe(protocols);

    const ws = builder.build();
    expect(ws.protocols).toBe(protocols);
  });

  test('WebsocketBuilder should set protocols for subsequent calls', () => {
    const protocols1 = ['protocol1', 'protocol2'];
    const protocols2 = ['protocol3', 'protocol4'];

    const builder = new WebsocketBuilder(url)
      .withProtocols(protocols1)
      .withProtocols(protocols2);
    expect(builder.protocols).toBe(protocols2);

    const ws = builder.build();
    expect(ws.protocols).toBe(protocols2);
  });

  test('WebsocketBuilder should set max-retries', () => {
    const maxRetries = 42;

    const builder = new WebsocketBuilder(url).withMaxRetries(maxRetries);
    expect(builder.maxRetries).toBe(maxRetries);

    const ws = builder.build();
    expect(ws.maxRetries).toBe(maxRetries);
  });

  test('WebsocketBuilder should set max-retries for subsequent calls', () => {
    const maxRetries1 = 42;
    const maxRetries2 = 1337;

    const builder = new WebsocketBuilder(url)
      .withMaxRetries(maxRetries1)
      .withMaxRetries(maxRetries2);
    expect(builder.maxRetries).toBe(maxRetries2);

    const ws = builder.build();
    expect(ws.maxRetries).toBe(maxRetries2);
  });

  test('WebsocketBuilder should return undefined for max-retries if not set', () => {
    const builder = new WebsocketBuilder(url);
    expect(builder.maxRetries).toBeUndefined();

    const ws = builder.build();
    expect(ws.maxRetries).toBeUndefined();
  });

  test('WebsocketBuilder should set instant-reconnect', () => {
    const instantReconnect = true;

    const builder = new WebsocketBuilder(url).withInstantReconnect(
      instantReconnect
    );
    expect(builder.instantReconnect).toBe(instantReconnect);

    const ws = builder.build();
    expect(ws.instantReconnect).toBe(instantReconnect);
  });

  test('WebsocketBuilder should return undefined for instant-reconnect if not set', () => {
    const builder = new WebsocketBuilder(url);
    expect(builder.instantReconnect).toBeUndefined();

    const ws = builder.build();
    expect(ws.instantReconnect).toBeUndefined();
  });

  test('WebsocketBuilder should set backoff', () => {
    const backoff = new ConstantBackoff(42);

    const builder = new WebsocketBuilder(url).withBackoff(backoff);
    expect(builder.backoff).toBe(backoff);

    const ws = builder.build();
    expect(ws.backoff).toBe(backoff);
  });

  test('WebsocketBuilder should set backoff for subsequent calls', () => {
    const backoff1 = new ConstantBackoff(42);
    const backoff2 = new ConstantBackoff(1337);

    const builder = new WebsocketBuilder(url)
      .withBackoff(backoff1)
      .withBackoff(backoff2);
    expect(builder.backoff).toBe(backoff2);

    const ws = builder.build();
    expect(ws.backoff).toBe(backoff2);
  });

  test('WebsocketBuilder should return undefined for backoff if not set', () => {
    const builder = new WebsocketBuilder(url);
    expect(builder.backoff).toBeUndefined();

    const ws = builder.build();
    expect(ws.backoff).toBeUndefined();
  });

  test('WebsocketBuilder should set buffer', () => {
    const buffer: WebsocketBuffer = new ArrayQueue();

    const builder = new WebsocketBuilder(url).withBuffer(buffer);
    expect(builder.buffer).toBe(buffer);

    const ws = builder.build();
    expect(ws.buffer).toBe(buffer);
  });

  test('WebsocketBuilder should set buffer for subsequent calls', () => {
    const buffer1: WebsocketBuffer = new ArrayQueue();
    const buffer2: WebsocketBuffer = new ArrayQueue();

    const builder = new WebsocketBuilder(url)
      .withBuffer(buffer1)
      .withBuffer(buffer2);
    expect(builder.buffer).toBe(buffer2);

    const ws = builder.build();
    expect(ws.buffer).toBe(buffer2);
  });

  test('WebsocketBuilder should return undefined for buffer if not set', () => {
    const builder = new WebsocketBuilder(url);
    expect(builder.buffer).toBeUndefined();

    const ws = builder.build();
    expect(ws.buffer).toBeUndefined();
  });

  test("WebsocketBuilder should set 'open'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onOpen(listener);
    expect(builder['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']['listeners'].open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'open'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onOpen(listener1)
      .onOpen(listener2);
    expect(builder['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'open'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onOpen(listener, options);
    expect(builder['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([{ listener, options }]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([{ listener, options }]);
  });

  test("WebsocketBuilder should set 'open'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onOpen(listener1)
      .onOpen(listener2, options);
    expect(builder['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.open).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.open>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test("WebsocketBuilder should set 'close'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onClose(listener);
    expect(builder['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'close'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onClose(listener1)
      .onClose(listener2);
    expect(builder['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'close'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onClose(listener, options);
    expect(builder['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener,
        options,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([{ listener, options }]);
  });

  test("WebsocketBuilder should set 'close'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onClose(listener1)
      .onClose(listener2, options);
    expect(builder['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.close).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.close>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test("WebsocketBuilder should set 'error'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onError(listener);
    expect(builder['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'error'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onError(listener1)
      .onError(listener2);
    expect(builder['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'error'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onError(listener, options);
    expect(builder['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener,
        options,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([{ listener, options }]);
  });

  test("WebsocketBuilder should set 'error'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onError(listener1)
      .onError(listener2, options);
    expect(builder['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.error).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.error>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test("WebsocketBuilder should set 'message'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onMessage(listener);
    expect(builder['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'message'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onMessage(listener1)
      .onMessage(listener2);
    expect(builder['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'message'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onMessage(listener, options);
    expect(builder['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener,
        options,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener,
        options,
      },
    ]);
  });

  test("WebsocketBuilder should set 'message'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onMessage(listener1)
      .onMessage(listener2, options);
    expect(builder['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.message).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.message>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test("WebsocketBuilder should set 'retry'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onRetry(listener);
    expect(builder['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'retry'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onRetry(listener1)
      .onRetry(listener2);
    expect(builder['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'retry'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onRetry(listener, options);
    expect(builder['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener,
        options,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([{ listener, options }]);
  });

  test("WebsocketBuilder should set 'retry'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onRetry(listener1)
      .onRetry(listener2, options);
    expect(builder['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.retry).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.retry>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test("WebsocketBuilder should set 'reconnect'-listener", () => {
    const listener = vi.fn();

    const builder = new WebsocketBuilder(url).onReconnect(listener);
    expect(builder['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener,
        options: undefined,
      },
    ]);
  });

  test("WebsocketBuilder should set 'reconnect'-listener for subsequent calls", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const builder = new WebsocketBuilder(url)
      .onReconnect(listener1)
      .onReconnect(listener2);
    expect(builder['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options: undefined },
    ]);
  });

  test("WebsocketBuilder should set 'reconnect'-listener with options", () => {
    const listener = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url).onReconnect(listener, options);
    expect(builder['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener,
        options,
      },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener,
        options,
      },
    ]);
  });

  test("WebsocketBuilder should set 'reconnect'-listener with mixed options", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const options = { once: true };

    const builder = new WebsocketBuilder(url)
      .onReconnect(listener1)
      .onReconnect(listener2, options);
    expect(builder['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);

    const ws = builder.build();
    expect(ws['_options']!['listeners']!.reconnect).toStrictEqual<
      WebsocketEventListenerWithOptions<WebsocketEvent.reconnect>[]
    >([
      {
        listener: listener1,
        options: undefined,
      },
      { listener: listener2, options },
    ]);
  });

  test('WebsocketBuilder should return a Websocket instance', () => {
    const builder = new WebsocketBuilder(url);
    const ws = builder.build();

    expect(ws).toBeInstanceOf(Websocket);
  });

  test("WebsocketBuilder should create new Websocket instances with subsequent 'build' calls", () => {
    const builder = new WebsocketBuilder(url);
    const ws1 = builder.build();
    const ws2 = builder.build();

    expect(ws1).not.toBe(ws2);
  });
});
