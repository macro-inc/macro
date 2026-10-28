import { afterEach, expect, test, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import type { Websocket, WebsocketData } from '../';
import { JsonSerializer, WebsocketBuilder, WebsocketEvent } from '../';
import { startServer, stopClient, stopServer } from './websocket-test-utils';

let server: WebSocketServer | undefined;
let client: Websocket | undefined;

afterEach(async () => {
  await stopClient(client, 5000);
  await stopServer(server, 5000);
  client = undefined;
  server = undefined;
});

test('waits for explicit session activation, then closes without reconnecting on wake', async () => {
  server = await startServer(0, 5000);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP server');
  const resolveUrl = vi.fn(() => `ws://localhost:${address.port}`);
  client = new WebsocketBuilder(resolveUrl)
    .withAutoConnect(false)
    .withSerializer(new JsonSerializer<WebsocketData, WebsocketData>())
    .build();

  expect(resolveUrl).not.toHaveBeenCalled();
  expect(client.closedByUser).toBe(true);
  expect(client.readyState).toBe(WebSocket.CLOSED);
  expect(client.bufferedAmount).toBe(0);
  expect(client.extensions).toBe('');
  expect(client.send('signed out')).toBe(false);
  client.reconnectIfDisconnected();
  expect(resolveUrl).not.toHaveBeenCalled();

  const opened = Promise.withResolvers<void>();
  client.addEventListener(WebsocketEvent.Open, () => opened.resolve(), {
    once: true,
  });
  client.reconnect();
  expect(client.readyState).toBe(WebSocket.CONNECTING);
  expect(client.bufferedAmount).toBe(0);
  expect(client.extensions).toBe('');
  await opened.promise;
  expect(client.readyState).toBe(WebSocket.OPEN);
  expect(resolveUrl).toHaveBeenCalledOnce();
  expect(client.send('signed in')).toBe(true);

  const closed = Promise.withResolvers<void>();
  client.addEventListener(WebsocketEvent.Close, () => closed.resolve(), {
    once: true,
  });
  client.close();
  await closed.promise;
  client.reconnectIfDisconnected();
  expect(resolveUrl).toHaveBeenCalledOnce();
  expect(client.send('signed out again')).toBe(false);

  const reopened = Promise.withResolvers<void>();
  client.addEventListener(WebsocketEvent.Open, () => reopened.resolve(), {
    once: true,
  });
  client.reconnect();
  await reopened.promise;
  expect(resolveUrl).toHaveBeenCalledTimes(2);
  expect(client.send('new session')).toBe(true);
});

test('discards credentials still resolving when a session is replaced', async () => {
  server = await startServer(0, 5000);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP server');
  const oldUrl = Promise.withResolvers<string>();
  const newUrl = `ws://localhost:${address.port}/?session=new`;
  const resolveUrl = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(oldUrl.promise)
    .mockResolvedValue(newUrl);
  client = new WebsocketBuilder(resolveUrl).withAutoConnect(false).build();
  const opened = Promise.withResolvers<void>();
  const resolved = vi.fn();
  client.addEventListener(WebsocketEvent.UrlResolved, resolved);
  client.addEventListener(WebsocketEvent.Open, () => opened.resolve(), {
    once: true,
  });

  client.reconnect();
  client.close();
  client.reconnect();
  oldUrl.resolve(`ws://localhost:${address.port}/?session=old`);
  await opened.promise;
  expect(resolveUrl).toHaveBeenCalledTimes(2);
  expect(resolved).toHaveBeenCalledOnce();
  expect(client.url).toBe(newUrl);
});

test('does not create a native socket when a URL listener closes it', async () => {
  const resolved = Promise.withResolvers<void>();
  const factory = vi.fn(() => {
    throw new Error('Unexpected socket creation');
  });
  client = new WebsocketBuilder('ws://unused')
    .withAutoConnect(false)
    .withFactory(factory)
    .build();
  client.addEventListener(WebsocketEvent.UrlResolved, (socket) => {
    socket.close();
    resolved.resolve();
  });
  client.reconnect();
  await resolved.promise;
  expect(factory).not.toHaveBeenCalled();
  expect(client.closedByUser).toBe(true);
});

test('resolves fresh credentials when a URL listener replaces the session', async () => {
  server = await startServer(0, 5000);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP server');
  const urls: (string | undefined)[] = [];
  server.on('connection', (_, request) => urls.push(request.url));
  const resolveUrl = vi
    .fn()
    .mockReturnValueOnce(`ws://localhost:${address.port}/?session=old`)
    .mockReturnValue(`ws://localhost:${address.port}/?session=new`);
  const opened = Promise.withResolvers<void>();
  client = new WebsocketBuilder(resolveUrl)
    .withAutoConnect(false)
    .onOpen(() => opened.resolve())
    .build();
  client.addEventListener(
    WebsocketEvent.UrlResolved,
    (socket) => {
      socket.close();
      socket.reconnect();
    },
    { once: true }
  );
  client.reconnect();
  await opened.promise;
  expect(resolveUrl).toHaveBeenCalledTimes(2);
  expect(urls).toEqual(['/?session=new']);
});
