import { AuthState, createAuthChangeEffect } from '@core/auth';
import {
  type Accessor,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
} from 'solid-js';
import type { MinimalWebSocket, WebSocketFactory } from './MinimalWebSocket';
import { isTauri, TauriWebSocketWrapper } from './TauriWebSocket';

export type { MinimalWebSocket, WebSocketFactory } from './MinimalWebSocket';

export {
  createReconnectingWS,
  createWS,
  makeHeartbeatWS,
  makeReconnectingWS,
  makeWS,
  type ReconnectingWebSocket,
  type WSHeartbeatOptions,
  type WSMessage,
  type WSReconnectOptions,
} from './SolidPrimitives';
export type WebSocketMessage =
  | string
  | ArrayBufferLike
  | ArrayBufferView
  | Blob;

export type ObjectLike = Record<string, any>;

export enum WebSocketState {
  Connecting = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
}

type ExponentialBackoffOptions = {
  backoffStrategy?: 'exponential';
  delay?: number;
  maxDelay?: number;
  factor?: number;
};

type LinearBackoffOptions = {
  backoffStrategy: 'linear';
  delay?: number;
  maxDelay?: number;
  increment?: number;
};

type ConstantBackoffOptions = {
  backoffStrategy: 'constant';
  delay?: number;
};

type BackoffOptions =
  | ExponentialBackoffOptions
  | LinearBackoffOptions
  | ConstantBackoffOptions;

type ReconnectOptions = {
  reconnectUrlResolver?: () => string | Promise<string>;
  retries?: number;
} & BackoffOptions;

export type DurableSocketOptions = {
  protocols?: string | string[];
  webSocketFactory?: WebSocketFactory;
} & ReconnectOptions;

export type IdentityPlugin = <S, R>(
  ws: DurableSocket<S, R>
) => DurableSocket<S, R>;

type AnyPlugin<Send, Receive> = SocketPlugin<Send, Receive> | IdentityPlugin;

export type SocketPlugin<Send, Receive> = (
  ws: DurableSocket<Send, Receive>
) => DurableSocket<Send, Receive>;

export type DurableSocket<
  Send = WebSocketMessage,
  Receive = WebSocketMessage,
> = Omit<WebSocket, 'send'> & {
  readonly _send?: Send;
  readonly _receive?: Receive;
  send(data: Send): void;
  chainSend<Send, Receive>(
    ws: DurableSocket<Send, Receive>,
    wrap: (next: (data: any) => void) => (data: Send) => void
  ): void;
  reconnect: () => void;
};

const DEFAULT_BACKOFF = {
  exponential: {
    delay: 500,
    maxDelay: 30000,
    factor: 2,
  },
  linear: {
    delay: 500,
    maxDelay: 30000,
    increment: 1000,
  },
  constant: {
    delay: 1000,
  },
  none: {},
};

function isLinearBackoff(opts: BackoffOptions): opts is LinearBackoffOptions {
  return opts.backoffStrategy === 'linear';
}

function isExponentialBackoff(
  opts: BackoffOptions
): opts is ExponentialBackoffOptions {
  return opts.backoffStrategy === 'exponential';
}

function isConstantBackoff(
  opts: BackoffOptions
): opts is ConstantBackoffOptions {
  return opts.backoffStrategy === 'constant';
}

const DEFAULT_RETRIES = Infinity;

const PREV_SEND = Symbol('previousSend');

/**
 * Platform-aware WebSocket factory that uses Tauri WebSocket in Tauri environments
 * and falls back to native WebSocket otherwise
 */
export const platformWebSocketFactory: WebSocketFactory = (url, protocols) => {
  if (isTauri()) {
    return new TauriWebSocketWrapper(url.toString(), protocols);
  }

  return new WebSocket(url, protocols) as MinimalWebSocket;
};

export function makeDurableSocket<
  Send = WebSocketMessage,
  Receive = WebSocketMessage,
>(
  url: string,
  options?: DurableSocketOptions,
  plugins: AnyPlugin<Send, Receive>[] = []
): DurableSocket<Send, Receive> {
  const strategy = options?.backoffStrategy ?? 'exponential';
  const defaults = DEFAULT_BACKOFF[strategy];
  const opts = {
    backoffStrategy: strategy,
    retries: options?.retries ?? DEFAULT_RETRIES,
    reconnectUrlResolver: options?.reconnectUrlResolver,
    protocols: options?.protocols,
    webSocketFactory: options?.webSocketFactory,
    ...defaults,
    ...options,
  };

  const resolveUrl = opts.reconnectUrlResolver;
  const webSocketFactory = opts.webSocketFactory ?? platformWebSocketFactory;
  let currentRetries = opts.retries;
  let reconnectAttempt = 0;
  const suppressedCloses = new WeakSet<MinimalWebSocket>();
  let ws: MinimalWebSocket;
  let durableWs: DurableSocket<Send, Receive>;
  let isReconnecting = false;

  const messageQueue: WebSocketMessage[] = [];
  const eventHandlers = new Map<string, Set<EventListener>>();

  const getReconnectDelay = () => {
    let delay: number;

    if (isLinearBackoff(opts)) {
      const increment = opts.increment ?? DEFAULT_BACKOFF.linear.increment;
      const baseDelay = opts.delay ?? DEFAULT_BACKOFF.linear.delay;
      const maxDelay = opts.maxDelay ?? DEFAULT_BACKOFF.linear.maxDelay;
      delay = baseDelay + reconnectAttempt * increment;
      delay = Math.min(delay, maxDelay);
    } else if (isExponentialBackoff(opts)) {
      const factor = opts.factor ?? DEFAULT_BACKOFF.exponential.factor;
      const baseDelay = opts.delay ?? DEFAULT_BACKOFF.exponential.delay;
      const maxDelay = opts.maxDelay ?? DEFAULT_BACKOFF.exponential.maxDelay;
      delay = baseDelay * Math.pow(factor, reconnectAttempt);
      delay = Math.min(delay, maxDelay);
    } else if (isConstantBackoff(opts)) {
      delay = (opts as ConstantBackoffOptions).delay ?? 1000;
    } else {
      throw new Error('Invalid backoff strategy');
    }

    reconnectAttempt++;
    return Math.round(delay);
  };

  const maybeResolveUrl = async () => {
    if (resolveUrl) {
      try {
        url = await resolveUrl();
      } catch (e) {
        console.error('Reconnect URL resolver failed', e);
      }
    }
  };

  const reconnect = async () => {
    if (isReconnecting) return;
    isReconnecting = true;

    // mark the current instance as intentionally closing
    if (ws && ws.readyState < WebSocketState.Closing) {
      suppressedCloses.add(ws);
      ws.close();
    }

    currentRetries = opts.retries;
    reconnectAttempt = 0;
    await maybeResolveUrl();
    createConnection();
    reattachEventHandlers();
  };

  const chainSend = <Send, Receive>(
    ws: DurableSocket<Send, Receive>,
    wrap: (next: (data: any) => void) => (data: Send) => void
  ): void => {
    const next = ws.send.bind(ws);
    (ws as any)[PREV_SEND] = next;
    ws.send = wrap(next) as typeof ws.send;
  };

  const createConnection = () => {
    ws = webSocketFactory(url, opts.protocols);

    // NB: Do not alter this block or touch currentWs!
    // There is a spooky stale reference bug where the original send
    // refers to the memory address of the first instance of ws instead
    // of the current instance. This causes sending to the old closed socket
    // after a reconnect, instead of the current socket.
    //
    // I tried to create a unit test for this but I wansn't able to in a reasonable amount of time.
    const currentWs = ws; // Capture the current instance
    const originalSend = currentWs.send.bind(currentWs);
    currentWs.send = (data: WebSocketMessage) => {
      if (currentWs.readyState === WebSocketState.Open) {
        originalSend(data);
      } else {
        messageQueue.push(data);
      }
    };

    // use currentWs here, not ws
    currentWs.addEventListener('open', () => {
      reconnectAttempt = 0;
      isReconnecting = false;
      currentRetries = opts.retries;

      while (messageQueue.length > 0) {
        const msg = messageQueue.shift()!;
        originalSend(msg);
      }
    });

    currentWs.addEventListener('close', async () => {
      // ignore only if this particular socket was intentionally closed
      if (suppressedCloses.has(currentWs)) {
        suppressedCloses.delete(currentWs);
        return;
      }

      if (currentRetries > 0) {
        (durableWs as any).dispatchEvent?.(new Event('reconnecting'));

        currentRetries--;
        const delay = getReconnectDelay();
        setTimeout(async () => {
          await maybeResolveUrl();
          createConnection();
          reattachEventHandlers();
        }, delay);
      }
    });
    (ws as DurableSocket<Send, Receive>).reconnect = reconnect;
    (ws as DurableSocket<Send, Receive>).chainSend = chainSend;

    enhancedWs = ws as DurableSocket<Send, Receive>;
    for (const plugin of plugins) {
      enhancedWs = plugin(enhancedWs as DurableSocket<Send, Receive>);
    }

    Object.setPrototypeOf(durableWs, enhancedWs);

    for (const prop in enhancedWs) {
      if (!(prop in durableWs)) {
        const descriptor = Object.getOwnPropertyDescriptor(enhancedWs, prop);
        if (descriptor) {
          Object.defineProperty(durableWs, prop, descriptor);
        }
      }
    }
  };

  const reattachEventHandlers = () => {
    eventHandlers.forEach((handlers, type) => {
      handlers.forEach((handler) => {
        durableWs.addEventListener(type, handler);
      });
    });
  };

  let enhancedWs: DurableSocket<Send, Receive> | null = null;

  durableWs = {
    get binaryType() {
      return ws?.binaryType;
    },
    set binaryType(value) {
      if (ws) ws.binaryType = value;
    },
    get bufferedAmount() {
      return ws?.bufferedAmount || 0;
    },
    get extensions() {
      return ws?.extensions || '';
    },
    get onclose() {
      return ws?.onclose || null;
    },
    set onclose(value) {
      if (ws) ws.onclose = value;
    },
    get onerror() {
      return ws?.onerror || null;
    },
    set onerror(value) {
      if (ws) ws.onerror = value;
    },
    get onmessage() {
      return ws?.onmessage || null;
    },
    set onmessage(value) {
      if (ws) ws.onmessage = value;
    },
    get onopen() {
      return ws?.onopen || null;
    },
    set onopen(value) {
      if (ws) ws.onopen = value;
    },
    get protocol() {
      return ws?.protocol || '';
    },
    get readyState() {
      return ws?.readyState || WebSocketState.Connecting;
    },
    get url() {
      return ws?.url || url;
    },
    set url(value) {
      url = value;
    },

    addEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
      options?: boolean | AddEventListenerOptions
    ) {
      if (!eventHandlers.has(type)) {
        eventHandlers.set(type, new Set());
      }
      eventHandlers.get(type)!.add(listener as EventListener);

      // Always attach to the current underlying target (plugins wrap ws.addEventListener anyway)
      (enhancedWs ?? ws)?.addEventListener(
        type as any,
        listener as any,
        options as any
      );
    },

    removeEventListener<K extends keyof WebSocketEventMap>(
      type: K,
      listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
      options?: boolean | EventListenerOptions
    ) {
      eventHandlers.get(type)?.delete(listener as EventListener);

      const targets = new Set<any>([ws, enhancedWs]); // dedupe if they are the same
      for (const t of targets) {
        t?.removeEventListener?.(type as any, listener as any, options as any);
      }
    },

    dispatchEvent(event: Event): boolean {
      return ws?.dispatchEvent(event) || false;
    },

    close(code?: number, reason?: string) {
      suppressedCloses.add(ws);
      currentRetries = 0;
      ws?.close(code, reason);
    },

    chainSend<Send, Receive>(
      ws: DurableSocket<Send, Receive>,
      wrap: (next: (data: any) => void) => (data: Send) => void
    ): void {
      chainSend(ws, wrap);
    },

    send(data: Send) {
      ws?.send(data as any);
    },

    reconnect() {
      reconnect();
    },

    CONNECTING: WebSocketState.Connecting,
    OPEN: WebSocketState.Open,
    CLOSING: WebSocketState.Closing,
    CLOSED: WebSocketState.Closed,
  } as DurableSocket<Send, Receive>;

  createConnection();

  durableWs.send;

  return durableWs;
}

export function createDurableSocket<
  Send = WebSocketMessage,
  Receive = WebSocketMessage,
>(
  url: string,
  options?: DurableSocketOptions,
  plugins: AnyPlugin<Send, Receive>[] = []
): DurableSocket<Send, Receive> {
  return createRoot(() => {
    return makeDurableSocket<Send, Receive>(url, options, plugins);
  });
}

/**
 * Returns a reactive state signal for the web socket's readyState:
 * ```ts
 * const ws = createWS('ws://localhost:5000');
 * const state = createWSState(ws);
 * const states = ["Connecting", "Open", "Closing", "Closed"] as const;
 * return <div>{states[state()]}</div>
 * ```
 */

export const createWSState = (
  ws: DurableSocket<any, any>
): Accessor<WebSocketState> => {
  const [state, setState] = createSignal<WebSocketState>(ws.readyState);

  ws.addEventListener('open', () => {
    setState(WebSocketState.Open);
    reconnecting = false;
  });

  const _close = ws.close.bind(ws);
  ws.close = (...args) => {
    setState(WebSocketState.Closing);
    _close(...args);
  };

  ws.addEventListener('reconnecting' as any, () => {
    reconnecting = true;
    setState(WebSocketState.Connecting);
  });

  ws.addEventListener('close', () => {
    if (!reconnecting) setState(WebSocketState.Closed);
  });

  let reconnecting = false;
  const _reconnect = ws.reconnect.bind(ws);
  ws.reconnect = () => {
    reconnecting = true;
    setState(WebSocketState.Connecting);
    _reconnect();
  };

  return state;
};

export type HeartbeatOptions = {
  message?: WebSocketMessage;
  response?: WebSocketMessage;
  interval?: number;
  wait?: number;
  maxMissedPongs?: number;
};

const DEFAULT_HEARTBEAT_OPTIONS: Required<HeartbeatOptions> = {
  message: 'ping',
  response: 'pong',
  interval: 25_000,
  wait: 10_000,
  maxMissedPongs: 0,
};

export function heartbeatPlugin(
  options: HeartbeatOptions = {}
): IdentityPlugin {
  const opts = { ...DEFAULT_HEARTBEAT_OPTIONS, ...options };

  return (ws: DurableSocket<any, any>) => {
    let consecutiveMissed = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(idleTimer);
      clearTimeout(pongTimer);
      idleTimer = undefined;
      pongTimer = undefined;
    };

    const sendPing = () => {
      ws.send(opts.message);

      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        consecutiveMissed++;
        if (consecutiveMissed > opts.maxMissedPongs) {
          console.warn(
            `Heartbeat failure: ${consecutiveMissed} consecutive missed pongs`
          );
          if (ws.readyState === WebSocketState.Open) {
            console.warn('Reconnecting due to missed pongs');
            ws.reconnect();
          }
        } else {
          scheduleNextPing();
        }
      }, opts.wait);
    };

    const scheduleNextPing = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(sendPing, opts.interval);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data === opts.response || event.data === 'pong') {
        consecutiveMissed = 0;
        clearTimeout(pongTimer);
        pongTimer = undefined;
      }
      scheduleNextPing();
    };

    ws.chainSend(ws, (next) => (data: WebSocketMessage) => {
      return next(data);
    });

    ws.addEventListener('open', () => {
      consecutiveMissed = 0;
      scheduleNextPing();
    });
    ws.addEventListener('close', clearTimers);
    ws.addEventListener('error', clearTimers);
    ws.addEventListener('message', onMessage);

    return ws;
  };
}

/**
 * DurableSocker plugin for using with bebop binary protocol
 *
 * Will automatically encode and decode websocket messages
 *
 * @param sendType
 * @param receiveType
 * @param onFailedParse
 * @returns
 */
export function bebopPlugin<Send, Receive>(
  sendType: { encode: (data: Send) => Uint8Array },
  receiveType: { decode: (data: Uint8Array) => Receive },
  onFailedParse?: (e: Error) => void
): SocketPlugin<Send, Receive> {
  return (ws) => {
    const originalAddEventListener = ws.addEventListener.bind(ws);

    ws.chainSend(ws, (next) => (data: Send) => {
      if (typeof data === 'string') {
        next(data);
        return;
      }
      const encoded = sendType.encode(data);
      next(encoded);
    });

    ws.addEventListener = (
      type: string,
      listener: EventListener,
      options?: any
    ) => {
      if (type === 'message') {
        const wrappedListener = async (e: MessageEvent) => {
          if (
            !(
              e.data instanceof Blob ||
              Object.prototype.toString.call(e.data) === '[object Blob]'
            )
          ) {
            onFailedParse?.(
              new Error('Expected Blob, received ' + typeof e.data)
            );
            return;
          }
          try {
            const buffer = new Uint8Array(await e.data.arrayBuffer());
            const decoded = receiveType.decode(buffer);
            const { ports: _, ...rest } = e;
            const newEvent = new MessageEvent('message', {
              ...rest,
              data: decoded,
            });
            listener(newEvent);
          } catch (error) {
            console.error('Failed to parse bebop message', error);
            onFailedParse?.(error as Error);
          }
        };

        originalAddEventListener(
          'message',
          wrappedListener as EventListener,
          options
        );
      } else {
        originalAddEventListener(type, listener, options);
      }
    };

    return ws;
  };
}

export function jsonPlugin<Send = any, Receive = any>(
  onFailedParse?: (e: Error) => void
): SocketPlugin<Send, Receive> {
  return (ws) => {
    ws.chainSend(ws, (next) => (data: Send | string) => {
      if (typeof data === 'string') {
        next(data);
        return;
      }
      try {
        next(JSON.stringify(data));
      } catch (err) {
        onFailedParse?.(err as Error);
      }
    });

    const add = ws.addEventListener.bind(ws);
    const remove = ws.removeEventListener.bind(ws);

    const listenerMap = new WeakMap<EventListener, EventListener>();

    ws.addEventListener = (
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (type !== 'message') {
        add(type, listener, options);
        return;
      }

      const wrapped: EventListener = (e: MessageEvent) => {
        if (typeof e.data === 'string' && /^[{\[]|^"/.test(e.data.trim())) {
          try {
            const parsed = JSON.parse(e.data) as Receive;
            listener(
              new MessageEvent('message', {
                data: parsed,
                origin: e.origin,
                lastEventId: e.lastEventId,
                source: e.source,
              })
            );
            return;
          } catch (err) {
            console.error('Failed to parse message', err);
            onFailedParse?.(err as Error);
          }
        }

        listener(e);
      };

      listenerMap.set(listener, wrapped);
      add('message', wrapped, options);
    };

    ws.removeEventListener = (
      type: string,
      listener: EventListener,
      options?: boolean | EventListenerOptions
    ) => {
      if (type !== 'message') {
        remove(type, listener, options);
        return;
      }

      const wrapped = listenerMap.get(listener);
      if (wrapped) {
        remove('message', wrapped, options);
        listenerMap.delete(listener);
      } else {
        remove(type, listener, options);
      }
    };

    return ws;
  };
}

export function createSocketEffect<Receive>(
  ws: DurableSocket<any, Receive>,
  callback: (data: Receive) => void
) {
  const messageHandler = (e: MessageEvent) => {
    const data = e.data;
    callback(data);
  };

  ws.addEventListener('message', messageHandler);

  const dispose = () => {
    ws.removeEventListener('message', messageHandler);
  };

  if (getOwner()) {
    onCleanup(() => {
      dispose();
    });
  }

  return dispose;
}

export type AuthPluginOptions = {
  /** Check if user is authenticated */
  isAuthenticated: () => boolean;
  /** Callback when authentication check blocks connection */
  onAuthBlocked?: () => void;
};

/**
 * DurableSocket plugin for requiring authentication
 *
 * @param options - Configuration for authentication behavior
 * @returns IdentityPlugin
 */
export function authPlugin(options: AuthPluginOptions): IdentityPlugin {
  const { isAuthenticated, onAuthBlocked } = options;

  return (ws) => {
    const originalAddEventListener = ws.addEventListener.bind(ws);
    createAuthChangeEffect((stateChange) => {
      if (
        stateChange.from === AuthState.Unauthenticated &&
        stateChange.to === AuthState.Authenticated
      ) {
        ws.reconnect();
      }
    });

    ws.addEventListener = (
      type: string,
      listener: EventListener,
      options?: any
    ) => {
      if (type === 'open') {
        const wrappedListener = (e: Event) => {
          if (!isAuthenticated()) {
            ws.close();
            onAuthBlocked?.();
            return;
          }
          listener(e);
        };
        originalAddEventListener('open', wrappedListener, options);
      } else {
        originalAddEventListener(type, listener, options);
      }
    };

    if (ws.readyState === WebSocketState.Connecting && !isAuthenticated()) {
      ws.close();
      onAuthBlocked?.();
    }

    return ws;
  };
}

/**
 * Creates a reactive effect that responds to websocket messages with a specific event type.
 * This is particularly useful for event-based websocket protocols where messages have
 * a 'type' field to distinguish different kinds of events.
 *
 * @param ws - The DurableSocket instance to listen to
 * @param eventType - The specific event type to listen for (matches against message.type)
 * @param callback - Function to be called when a message of the specified type is received
 *
 * @example
 * ```ts
 * const ws = createDurableSocket('wss://api.example.com', undefined, [
 *   zodPlugin(sendSchema, receiveSchema)
 * ]);
 *
 * createWebsocketEventEffect(ws, 'user_update', (data) => {
 *   console.log('User updated:', data);
 *   updateUserState(data);
 * });
 *
 * createWebsocketEventEffect(ws, 'bulk_upload', (data) => {
 *   console.log('Bulk upload event:', data);
 *   processBulkUpload(data);
 * });
 * ```
 */
export function createWebsocketEventEffect<
  EventType extends string,
  Receive extends ObjectLike & { type: EventType },
>(
  ws: DurableSocket<any, any>,
  eventType: EventType,
  callback: (data: Receive) => void
) {
  const messageHandler = (e: MessageEvent) => {
    const data = e.data;

    if (
      data &&
      typeof data === 'object' &&
      'type' in data &&
      data.type === eventType
    ) {
      callback(data as Receive);
    }
  };

  ws.addEventListener('message', messageHandler);

  if (getOwner()) {
    onCleanup(() => {
      ws.removeEventListener('message', messageHandler);
    });
  }
}

/**
 * Creates multiple websocket event effects for different event types on the same socket.
 * This is a convenience function for setting up multiple event handlers at once.
 *
 * @param ws - The DurableSocket instance to listen to
 * @param handlers - An object mapping event types to their respective handlers
 *
 * @example
 * ```ts
 * const ws = createDurableSocket('wss://api.example.com', undefined, [
 *   zodPlugin(sendSchema, receiveSchema)
 * ]);
 *
 * createWebsocketEventEffects(ws, {
 *   user_update: (data) => updateUserState(data),
 *   bulk_upload: (data) => processBulkUpload(data),
 *   notification: (data) => showNotification(data),
 * });
 * ```
 */
export function createWebsocketEventEffects<
  EventHandlers extends Record<string, (data: any) => void>,
>(ws: DurableSocket<any, any>, handlers: EventHandlers) {
  Object.entries(handlers).forEach(([eventType, handler]) => {
    createWebsocketEventEffect(ws, eventType, handler);
  });
}

export function untilMessage<Receive>(
  ws: DurableSocket<any, Receive>,
  predicate: (data: Receive) => boolean
): Promise<Receive> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener('message', handler);
      ws.removeEventListener('close', closeHandler);
    };

    const handler = (e: MessageEvent) => {
      const data = e.data as Receive;
      if (predicate(data)) {
        cleanup();
        resolve(data);
      }
    };

    const closeHandler = () => {
      cleanup();
      reject(new Error('WebSocket closed before message received'));
    };

    ws.addEventListener('message', handler);
    ws.addEventListener('close', closeHandler);
  });
}

export function createReconnectEffect(
  ws: DurableSocket<any, any>,
  callback: () => void
) {
  let reconnecting = false;

  const reconnectingHandler = () => {
    reconnecting = true;
  };

  const openHandler = () => {
    if (reconnecting) {
      reconnecting = false;
      callback();
    }
  };

  ws.addEventListener('reconnecting', reconnectingHandler);
  ws.addEventListener('open', openHandler);

  if (getOwner()) {
    onCleanup(() => {
      ws.removeEventListener('reconnecting', reconnectingHandler);
      ws.removeEventListener('open', openHandler);
    });
  }
}
