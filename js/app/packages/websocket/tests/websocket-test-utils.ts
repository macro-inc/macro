import { WebSocketServer, WebSocket } from 'ws';
import {
  Websocket,
} from '../';
import {
  WebsocketEvent,
  WebsocketEventListenerWithOptions,
} from '../';

/**
 * Creates a promise that will be rejected after the given amount of milliseconds. The error will be a TimeoutError.
 * @param ms the amount of milliseconds to wait before rejecting
 * @param msg an optional message to include in the error
 */
export const rejectAfter = (ms: number, msg?: string): Promise<void> =>
  new Promise((_, reject) =>
    setTimeout(
      () => reject(msg ? new Error(`Timeout: ${msg}`) : new Error(`Timeout`)),
      ms
    )
  );

/**
 * Stops the given websocket client.
 * @param client the websocket client to stop
 * @param timeout the amount of milliseconds to wait before rejecting
 */
export const stopClient = (
  client: Websocket | undefined,
  timeout: number
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (client === undefined) return resolve();
    if (client.underlyingWebsocket?.readyState === WebSocket.CLOSED)
      return resolve();
    rejectAfter(timeout, 'failed to stop client').catch((err) => reject(err));
    client.addEventListener(WebsocketEvent.close, () => resolve(), {
      once: true,
    });
    client.close();
  });

/**
 * Starts a websocket server on the given port.
 * @param port the port to start the server on
 * @param timeout the amount of milliseconds to wait before rejecting
 */
export const startServer = (port: number, timeout: number): Promise<WebSocketServer> =>
  new Promise((resolve, reject) => {
    rejectAfter(timeout, 'failed to start server').catch((err) => reject(err));
    const wss = new WebSocketServer({ port });
    wss.on('listening', () => resolve(wss));
    wss.on('error', (err) => reject(err));
  });

/**
 * Stops the given websocket server. This will terminate all connections.
 * @param wss the websocket server to stop
 * @param timeout the amount of milliseconds to wait before rejecting
 */
export const stopServer = (
  wss: WebSocketServer | undefined,
  timeout: number
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (wss === undefined) return resolve();
    rejectAfter(timeout, 'failed to stop server').catch((err) => reject(err));
    wss.clients.forEach((c) => c.terminate());
    wss.addListener('close', resolve);
    wss.close();
  });

/**
 * Waits for a client to connect to the given websocket server.
 *
 * @param wss the websocket server to wait for a client to connect to
 * @param timeout the amount of milliseconds to wait before rejecting
 */
export const waitForClientToConnectToServer = (
  wss: WebSocketServer | undefined,
  timeout: number
): Promise<WebSocket> =>
  new Promise<WebSocket>((resolve, reject) => {
    if (wss === undefined) return reject(new Error('wss is undefined'));
    rejectAfter(timeout, 'failed to wait for client to connect').catch((err) =>
      reject(err)
    );
    wss.on('connection', (client) => resolve(client));
  });

/**
 * Returns the listeners for the given event type on the given websocket client.
 *
 * @param client the websocket client to get the listeners from
 * @param type the event type to get the listeners for
 */
export const getListenersWithOptions = <K extends WebsocketEvent>(
  client: Websocket | undefined,
  type: K
): WebsocketEventListenerWithOptions<K>[] =>
  client === undefined ? [] : (client['_options']['listeners'][type] ?? []);

/**
 * Converts a websocket message to a string.
 *
 * @param message the message to convert to a string
 * @param isBinary whether the message is binary
 * @returns the message as a string
 */
export const wsMessageToString = (
  message: ArrayBuffer | Blob | Buffer | Buffer[],
  isBinary: boolean
): string => {
  if (isBinary) {
    throw new Error('Unexpected binary message');
  } else if (!(message instanceof Buffer)) {
    throw new Error('Unexpected message type');
  } else return message.toString('utf-8');
};

/**
 * Converts a websocket message to a string and calls the given handler.
 *
 * @param handler the handler to call with the message
 */
export const onStringMessageReceived =
  (handler: (str: string) => void) =>
  (message: ArrayBuffer | Blob | Buffer | Buffer[], isBinary: boolean) => {
    handler(wsMessageToString(message, isBinary));
  };

/**
 * Closes the given websocket server and terminates all connections.
 *
 * @param wss the websocket server to close
 */
export const closeServer = (wss: WebSocketServer | undefined) => {
  if (wss === undefined) return;
  wss.clients.forEach((client) => client.terminate());
  wss.close();
}

export type WebsocketServerWithHeartbeat = WebSocketServer & {
  setRespondToPings: (value: boolean) => void;
};

/**
 * Starts a websocket server on the given port.
 * @param port the port to start the server on
 * @param timeout the amount of milliseconds to wait before rejecting
 */
export const startServerWithHeartbeat = (port: number, timeout: number): Promise<WebsocketServerWithHeartbeat> =>
  new Promise((resolve, reject) => {
    rejectAfter(timeout, 'failed to start server').catch((err) => reject(err));
    const wss = new WebSocketServer({ port });
    
    let respondToPings = true;
    
    wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        if (message.toString() === 'ping' && respondToPings) {
          ws.send('pong');
        }
      });
    });
    
    (wss as any).setRespondToPings = (value: boolean) => {
      respondToPings = value;
    };
    
    wss.on('listening', () => resolve(wss as any));
    wss.on('error', (err) => reject(err));
  });
