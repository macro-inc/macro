import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { platformWebSocketFactory } from './index';
import type { MinimalWebSocket, WebSocketFactory } from './MinimalWebSocket';

export type WSMessage = string | ArrayBufferLike | ArrayBufferView | Blob;

/**
 * Opens a WebSocket connection with a queued send mechanism and configurable factory.
 * Messages sent before connection opens are queued and sent when connection establishes.
 *
 * @param url - WebSocket URL
 * @param protocols - Optional protocols
 * @param webSocketFactory - Factory function to create WebSocket instances
 * @param sendQueue - Optional initial send queue
 * @returns WebSocket instance with enhanced send behavior
 *
 * @example
 * ```ts
 * const ws = makeWS("ws://localhost:5000", undefined, platformWebSocketFactory);
 * createEffect(() => ws.send(serverMessage()));
 * onCleanup(() => ws.close());
 * ```
 */
export const makeWS = (
  url: string,
  protocols?: string | string[],
  webSocketFactory: WebSocketFactory = platformWebSocketFactory,
  sendQueue: WSMessage[] = []
): MinimalWebSocket => {
  const ws = webSocketFactory(url, protocols);
  const _send = ws.send.bind(ws);
  ws.send = (msg: WSMessage) =>
    ws.readyState === 1 ? _send(msg) : sendQueue.push(msg);
  ws.addEventListener('open', () => {
    while (sendQueue.length) _send(sendQueue.shift()!);
  });
  return ws;
};

/**
 * Creates a WebSocket that automatically closes on cleanup, with configurable factory.
 *
 * @param url - WebSocket URL
 * @param protocols - Optional protocols
 * @param webSocketFactory - Factory function to create WebSocket instances
 * @returns WebSocket instance that closes on cleanup
 *
 * @example
 * ```ts
 * const ws = createWS("ws://localhost:5000", undefined, tauriWebSocketFactory);
 * ```
 */
export const createWS = (
  url: string,
  protocols?: string | string[],
  webSocketFactory: WebSocketFactory = platformWebSocketFactory
): MinimalWebSocket => {
  const ws = makeWS(url, protocols, webSocketFactory);
  onCleanup(() => ws.close());
  return ws;
};

/**
 * Creates a reactive state signal for the WebSocket's readyState.
 *
 * @param ws - WebSocket instance
 * @returns Reactive accessor for WebSocket state (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)
 *
 * @example
 * ```ts
 * const ws = createWS('ws://localhost:5000');
 * const state = createWSState(ws);
 * const states = ["Connecting", "Open", "Closing", "Closed"] as const;
 * return <div>{states[state()]}</div>
 * ```
 */
export const createWSState = (
  ws: MinimalWebSocket
): Accessor<0 | 1 | 2 | 3> => {
  const [state, setState] = createSignal(ws.readyState as 0 | 1 | 2 | 3);
  const _close = ws.close.bind(ws);
  ws.addEventListener('open', () => setState(1));
  ws.close = (...args) => {
    setState(2);
    _close(...args);
  };
  ws.addEventListener('close', () => setState(3));
  return state;
};

export type WSReconnectOptions = {
  delay?: number;
  retries?: number;
};

export type ReconnectingWebSocket = MinimalWebSocket & {
  reconnect: () => void;
  send: MinimalWebSocket['send'] & { before?: () => void };
};

/**
 * Creates a WebSocket with automatic reconnection capabilities.
 *
 * @param url - WebSocket URL
 * @param protocols - Optional protocols
 * @param options - Reconnection options
 * @param webSocketFactory - Factory function to create WebSocket instances
 * @returns Reconnecting WebSocket instance
 *
 * @example
 * ```ts
 * const ws = makeReconnectingWS("ws://localhost:5000", undefined, {
 *   delay: 1000,
 *   retries: 5
 * }, platformWebSocketFactory);
 * ```
 */
export const makeReconnectingWS = (
  url: string,
  protocols?: string | string[],
  options: WSReconnectOptions = {},
  webSocketFactory: WebSocketFactory = platformWebSocketFactory
): ReconnectingWebSocket => {
  const { delay = 1000, retries = Infinity } = options;
  let ws: MinimalWebSocket;
  let retriesLeft = retries;
  let timeoutId: ReturnType<typeof setTimeout>;
  const sendQueue: WSMessage[] = [];

  const connect = (): void => {
    ws = webSocketFactory(url, protocols);
    const _send = ws.send.bind(ws);

    ws.send = (msg: WSMessage) => {
      if (ws.readyState === 1) {
        _send(msg);
      } else {
        sendQueue.push(msg);
      }
    };

    ws.addEventListener('open', () => {
      retriesLeft = retries;
      while (sendQueue.length) {
        _send(sendQueue.shift()!);
      }
    });

    ws.addEventListener('close', (e: CloseEvent) => {
      if (retriesLeft > 0 && !e.wasClean) {
        retriesLeft--;
        timeoutId = setTimeout(connect, delay);
      }
    });

    ws.addEventListener('error', () => {
      if (retriesLeft > 0) {
        retriesLeft--;
        timeoutId = setTimeout(connect, delay);
      }
    });
  };

  const reconnect = (): void => {
    clearTimeout(timeoutId);
    retriesLeft = retries;
    ws?.close();
    connect();
  };

  connect();

  // Create proxy to forward all WebSocket properties and methods
  const reconnectingWS = new Proxy({} as ReconnectingWebSocket, {
    get(target, prop, receiver) {
      if (prop === 'reconnect') {
        return reconnect;
      }
      if (prop === 'send') {
        const baseSend = (...args: Parameters<MinimalWebSocket['send']>) => {
          const typedSend = baseSend as typeof baseSend & {
            before?: () => void;
          };
          if (typedSend.before) typedSend.before();
          return ws.send(...args);
        };
        const typedSend = baseSend as typeof baseSend & { before?: () => void };
        typedSend.before = undefined;
        return typedSend;
      }
      if (prop in ws) {
        const value = (ws as any)[prop];
        return typeof value === 'function' ? value.bind(ws) : value;
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      if (prop in ws) {
        (ws as any)[prop] = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });

  return reconnectingWS;
};

/**
 * Creates a reconnecting WebSocket that automatically closes on cleanup.
 *
 * @param url - WebSocket URL
 * @param protocols - Optional protocols
 * @param options - Reconnection options
 * @param webSocketFactory - Factory function to create WebSocket instances
 * @returns Reconnecting WebSocket that closes on cleanup
 *
 * @example
 * ```ts
 * const ws = createReconnectingWS("ws://localhost:5000", undefined, {
 *   delay: 1000,
 *   retries: 5
 * });
 * ```
 */
export const createReconnectingWS = (
  url: string,
  protocols?: string | string[],
  options: WSReconnectOptions = {},
  webSocketFactory: WebSocketFactory = platformWebSocketFactory
): ReconnectingWebSocket => {
  const ws = makeReconnectingWS(url, protocols, options, webSocketFactory);
  onCleanup(() => ws.close());
  return ws;
};

export type WSHeartbeatOptions = {
  message?: WSMessage;
  interval?: number;
  wait?: number;
};

/**
 * Adds heartbeat functionality to a reconnecting WebSocket.
 * Sends periodic ping messages and reconnects if no pong is received.
 *
 * @param ws - Reconnecting WebSocket instance
 * @param options - Heartbeat configuration
 * @returns The same WebSocket instance with heartbeat functionality
 *
 * @example
 * ```ts
 * const ws = makeReconnectingWS("ws://localhost:5000");
 * makeHeartbeatWS(ws, {
 *   message: "ping",
 *   interval: 30000,
 *   wait: 10000
 * });
 * ```
 */
export const makeHeartbeatWS = (
  ws: ReconnectingWebSocket,
  options: WSHeartbeatOptions = {}
): ReconnectingWebSocket => {
  const { message = 'ping', interval = 30000, wait = 10000 } = options;

  let heartbeatInterval: ReturnType<typeof setInterval>;
  let pongTimeout: ReturnType<typeof setTimeout>;
  let waitingForPong = false;

  const sendHeartbeat = (): void => {
    if (ws.readyState === 1 && !waitingForPong) {
      ws.send(message);
      waitingForPong = true;
      pongTimeout = setTimeout(() => {
        waitingForPong = false;
        ws.reconnect();
      }, wait);
    }
  };

  const resetHeartbeat = (): void => {
    clearInterval(heartbeatInterval);
    clearTimeout(pongTimeout);
    waitingForPong = false;
    if (ws.readyState === 1) {
      heartbeatInterval = setInterval(sendHeartbeat, interval);
    }
  };

  ws.send.before = () => {
    if (waitingForPong) {
      clearTimeout(pongTimeout);
      waitingForPong = false;
    }
  };

  ws.addEventListener('open', resetHeartbeat);
  ws.addEventListener('close', () => {
    clearInterval(heartbeatInterval);
    clearTimeout(pongTimeout);
    waitingForPong = false;
  });

  ws.addEventListener('message', () => {
    if (waitingForPong) {
      clearTimeout(pongTimeout);
      waitingForPong = false;
    }
  });

  return ws;
};
