import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import {
  ConstantBackoff,
  type Websocket,
  WebsocketBuilder,
  WebsocketEvent,
} from '../';
import { startServer, stopClient, stopServer } from './websocket-test-utils';

describe('authorization URL resolution failures', () => {
  let server: WebSocketServer | undefined;
  let client: Websocket | undefined;
  let url: string;

  beforeEach(async () => {
    server = await startServer(0, 5000);
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test server address');
    url = `ws://localhost:${address.port}`;
  });
  afterEach(async () => {
    if (client?.underlyingWebsocket) await stopClient(client, 5000);
    else client?.close();
    await stopServer(server, 5000);
    client = undefined;
  });

  it('retries rejected token requests without an unhandled rejection or an unauthorized socket', async () => {
    const resolver = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(url);
    const connections = vi.fn();
    server!.on('connection', connections);
    client = new WebsocketBuilder(resolver)
      .withBackoff(new ConstantBackoff(10))
      .withMaxRetries(3)
      .build();
    const errors = vi.fn();
    client.addEventListener(WebsocketEvent.Error, errors);
    await new Promise<void>((resolve) =>
      client!.addEventListener(WebsocketEvent.Open, () => resolve(), {
        once: true,
      })
    );
    expect(errors).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(connections).toHaveBeenCalledOnce();
  });

  it('does not retry a pending authorization rejected after the source is disposed', async () => {
    const pending = Promise.withResolvers<string>();
    const resolver = vi.fn(() => pending.promise);
    client = new WebsocketBuilder(resolver)
      .withBackoff(new ConstantBackoff(10))
      .build();
    client.close();
    pending.reject(new Error('Offline'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolver).toHaveBeenCalledOnce();
    expect(client.underlyingWebsocket).toBeUndefined();
  });
});
